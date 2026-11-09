"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Store = { id: string; name: string };
type Parsed = { name?: string; phone?: string; store?: Store; date?: string; time?: string; notes?: string };

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

// "today", "tomorrow", "Friday", "11/14", "11/14/2026", "2026-11-14", "Nov 14th" -> 2026-11-14 (counting from `today`).
function parseDate(raw: string, today: string): string | undefined {
  const t = raw.toLowerCase();
  const base = new Date(`${today}T12:00:00`);
  if (/\btoday\b/.test(t)) return today;
  if (/\btomorrow\b|\btmrw\b|\btmr\b/.test(t)) { base.setDate(base.getDate() + 1); return iso(base); }
  let m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = t.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : base.getFullYear();
    const d = new Date(y, +m[1] - 1, +m[2], 12);
    if (!m[3] && iso(d) < today) d.setFullYear(y + 1);
    return iso(d);
  }
  m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/);
  if (m) {
    const y = m[3] ? +m[3] : base.getFullYear();
    const d = new Date(y, MONTHS.indexOf(m[1]), +m[2], 12);
    if (!m[3] && iso(d) < today) d.setFullYear(y + 1);
    return iso(d);
  }
  const w = WEEKDAYS.findIndex((d) => new RegExp(`\\b${d.slice(0, 3)}(${d.slice(3)})?\\b`).test(t));
  if (w >= 0) {
    let add = (w - base.getDay() + 7) % 7;
    if (/\bnext\b/.test(t) && add === 0) add = 7;
    base.setDate(base.getDate() + add);
    return iso(base);
  }
  return undefined;
}

// "3:00 PM", "3pm", "3:30p", "15:00", "noon" -> 15:00
function parseTime(raw: string): string | undefined {
  const t = raw.toLowerCase();
  if (/\bnoon\b/.test(t)) return "12:00";
  let m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m?\.?|p\.?m?\.?)(?![a-z])/);
  if (m) {
    let h = +m[1] % 12;
    if (m[3].startsWith("p")) h += 12;
    return `${pad(h)}:${m[2] ?? "00"}`;
  }
  m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) {
    let h = +m[1];
    if (h >= 1 && h <= 6) h += 12; // service lanes don't book at 1–6 AM
    return `${pad(h)}:${m[2]}`;
  }
  return undefined;
}

function findStore(raw: string, stores: Store[]) {
  const n = norm(raw);
  if (!n) return undefined;
  return stores.find((s) => norm(s.name) === n)
    ?? stores.find((s) => norm(s.name).includes(n) || n.includes(norm(s.name)))
    ?? stores.map((s) => ({ s, score: norm(s.name).split(" ").filter((w) => w.length > 2 && n.split(" ").includes(w)).length })).sort((a, b) => b.score - a.score).find((x) => x.score >= 2)?.s;
}

export function parseBooking(text: string, stores: Store[], today: string): Parsed {
  const out: Parsed = {};
  const notes: string[] = [];
  const rest: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z /#&.'()-]{0,30}?)\s*[:=\-–]\s*(.+)$/);
    if (!m) { if (line.trim()) rest.push(line.trim()); continue; }
    const key = m[1].toLowerCase().trim();
    const val = m[2].trim();
    if (/vin|vehicle|car\b|year|make|model|advisor|service|reason|note|concern|comment/.test(key)) notes.push(`${m[1].trim()}: ${val}`);
    else if (/^(customer\s*)?(full\s*)?name|^customer$|^client|^guest/.test(key)) out.name ??= val;
    else if (/phone|cell|mobile|number|tel/.test(key)) out.phone ??= val;
    else if (/dealer|store|rooftop|location/.test(key)) out.store ??= findStore(val, stores);
    else if (/^date|^day|appt\s*date|appointment\s*date/.test(key)) out.date ??= parseDate(val, today);
    else if (/^time|appt\s*time|appointment\s*time/.test(key)) out.time ??= parseTime(val);
    else if (/^(appointment|appt|when|scheduled|booked)/.test(key)) { out.date ??= parseDate(val, today); out.time ??= parseTime(val); }
    else if (/department|dept/.test(key)) continue;
    else notes.push(`${m[1].trim()}: ${val}`);
  }
  // Unlabelled text: pick out a phone number, date, time and store name wherever they are.
  const all = text;
  if (!out.phone) out.phone = all.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0];
  if (!out.date) out.date = parseDate(all, today);
  if (!out.time) out.time = parseTime(all.replace(out.phone ?? "\u0000", ""));
  if (!out.store) {
    const words = new Set(norm(all).split(" "));
    const key = (n: string) => norm(n).split(" ").filter((w) => w.length > 2 && !["the", "and", "service", "motors", "auto"].includes(w));
    out.store = stores.find((s) => norm(all).includes(norm(s.name)))
      ?? stores.map((s) => ({ s, k: key(s.name) })).filter((x) => x.k.length >= 2 && x.k.every((w) => words.has(w))).sort((a, b) => b.k.length - a.k.length)[0]?.s;
  }
  if (!out.name && rest.length) {
    const lead = rest[0].match(/^([A-Za-z][A-Za-z'.-]+(?:\s+[A-Za-z][A-Za-z'.-]+){1,3}?)(?=\s*[,(]?\s*(?:\+?1?[\s.-]?\(?\d{3})|\s*$|\s*,)/);
    if (lead) out.name = lead[1];
  }
  if (out.phone) {
    const d = out.phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    if (d.length === 10) out.phone = `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  const extra = [...notes, ...rest].join(" · ");
  if (extra) out.notes = extra.slice(0, 1000);
  return out;
}

const KEY = "appt_paste";

// "Paste to fill" for the appointment form: agents paste call notes or a booking blurb, review, then save.
// If the paste names a different store, the page switches to that store and fills the form there.
export function PasteFill({ stores, currentStore, today }: { stores: Store[]; currentStore: string | null; today: string }) {
  const router = useRouter();
  const box = useRef<HTMLTextAreaElement>(null);
  const [msg, setMsg] = useState("");

  const apply = (p: Parsed) => {
    const form = document.querySelector<HTMLFormElement>("#set form");
    if (!form) return [];
    const filled: string[] = [];
    const set = (name: string, value: string | undefined, label: string) => {
      const el = form.elements.namedItem(name) as HTMLInputElement | null;
      if (!el || !value) return;
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      filled.push(label);
    };
    set("customer_name", p.name, "name");
    set("phone", p.phone, "phone");
    set("date", p.date, "date");
    set("time", p.time, "time");
    set("notes", p.notes, "notes");
    return filled;
  };

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
      if (saved && saved.store?.id === currentStore) {
        sessionStorage.removeItem(KEY);
        const filled = apply(saved);
        setMsg(`Switched to ${saved.store.name} and filled ${filled.join(", ")}. Check everything, then save.`);
      }
    } catch { /* nothing saved */ }
  }, [currentStore]); // eslint-disable-line react-hooks/exhaustive-deps

  const fill = () => {
    const text = box.current?.value ?? "";
    if (!text.trim()) return setMsg("Paste the booking notes first.");
    const p = parseBooking(text, stores, today);
    if (p.store && p.store.id !== currentStore) {
      try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage off */ }
      router.push(`/appointments?d=${p.store.id}#set`);
      return setMsg(`Opening ${p.store.name}…`);
    }
    if (!currentStore) return setMsg("Couldn't tell which dealership this is. Pick the store at the top right, or add a line like “Dealership: Acura of Palm Beach”.");
    const filled = apply(p);
    const missing = ["name", "phone", "date", "time"].filter((k) => !filled.includes(k));
    setMsg(filled.length ? `Filled ${filled.join(", ")}.${missing.length ? ` Couldn't find: ${missing.join(", ")}.` : ""} Check everything, then save.` : "Couldn't find anything to fill. Labeled lines work best (Name:, Phone:, Date:, Time:).");
  };

  return (
    <div className="paste-fill">
      <p className="paste-fill-head"><strong>Paste to fill</strong> <span>Paste call notes or a booking blurb. Fields fill as best as possible for you to review.</span></p>
      <label className="x-label" htmlFor="booking-notes">Booking notes</label>
      <textarea id="booking-notes" ref={box} className="x-input" rows={5} style={{ height: "auto", padding: 10 }}
        placeholder={"Name: Jane Doe\nPhone: (555) 123-4567\nDealership: Acura of Palm Beach\nDate: tomorrow\nTime: 3:00 PM\nNotes: oil change, 2021 MDX"} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" className="x-btn" onClick={fill}>Fill form</button>
        <button type="button" className="x-btn" onClick={() => { if (box.current) box.current.value = ""; setMsg(""); }}>Clear</button>
        {msg && <span role="status" className="text-sm">{msg}</span>}
      </div>
      <p className="text-sm text-ink-muted" style={{ marginTop: 6 }}>Labeled lines work best (Name, Phone, Dealership, Date, Time). The usual checks still run when you save.</p>
    </div>
  );
}
