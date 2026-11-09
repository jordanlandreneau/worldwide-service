"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const found = text.trim() ? parseBooking(text, stores, today) : null;
  const current = stores.find((s) => s.id === currentStore);

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
        apply(saved);
        setMsg({ tone: "ok", text: `Switched to ${saved.store.name} and filled the form below. Check it, then save.` });
      }
    } catch { /* nothing saved */ }
  }, [currentStore]); // eslint-disable-line react-hooks/exhaustive-deps

  const fill = () => {
    if (!found) return setMsg({ tone: "warn", text: "Paste the booking notes first." });
    if (found.store && found.store.id !== currentStore) {
      try { sessionStorage.setItem(KEY, JSON.stringify(found)); } catch { /* storage off */ }
      setMsg({ tone: "ok", text: `Opening ${found.store.name}…` });
      router.push(`/appointments?d=${found.store.id}#set`);
      return;
    }
    if (!currentStore) return setMsg({ tone: "warn", text: "Pick the dealership at the top right, or add a line like “Dealership: Acura of Palm Beach”." });
    const filled = apply(found);
    setMsg(filled.length ? { tone: "ok", text: "Filled the form below. Check it, then save." } : { tone: "warn", text: "Nothing to fill. Try labeled lines like Name:, Phone:, Date:, Time:." });
  };

  const show = (iso?: string) => iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : undefined;
  const clock = (t?: string) => { if (!t) return undefined; const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
  const rows: [string, string | undefined, boolean][] = [
    ["Name", found?.name, true],
    ["Phone", found?.phone, true],
    ["Dealership", found?.store?.name ?? (current ? `${current.name} (selected)` : undefined), true],
    ["Date", show(found?.date), true],
    ["Time", clock(found?.time), true],
    ["Notes", found?.notes, false],
  ];

  return (
    <section className="pf" aria-labelledby="pf-title">
      <div className="pf-head">
        <h3 id="pf-title">Paste to fill</h3>
        <p>Paste call notes or a booking blurb. Check what was found, then fill the form.</p>
      </div>
      <div className="pf-body">
        <div className="pf-paste">
          <label htmlFor="booking-notes">Booking notes</label>
          <textarea id="booking-notes" rows={7} value={text} onChange={(e) => { setText(e.target.value); setMsg(null); }}
            placeholder={"Name: Jane Doe\nPhone: (555) 123-4567\nDealership: Acura of Palm Beach\nDate: tomorrow\nTime: 3:00 PM\nNotes: oil change, 2021 MDX"} />
          <p className="pf-hint">Labeled lines work best, but a plain sentence works too.</p>
        </div>
        <div className="pf-found" aria-live="polite">
          <span className="pf-label">What it found</span>
          <dl>
            {rows.map(([k, v, needed]) => (
              <div key={k} className={v ? "ok" : needed ? "miss" : ""}>
                <dt>{k}</dt>
                <dd>{v ?? (needed ? (found ? "Not found" : "—") : "—")}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <div className="pf-foot">
        <button type="button" className="x-btn x-btn-primary" onClick={fill} disabled={!text.trim()}>Fill form</button>
        <button type="button" className="x-btn" onClick={() => { setText(""); setMsg(null); }} disabled={!text}>Clear</button>
        {msg && <span role="status" className={`pf-msg ${msg.tone}`}>{msg.text}</span>}
      </div>
    </section>
  );
}
