"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { globalSearch, type Found } from "@/lib/search";

const ZONES: [string, string][] = [["ET", "America/New_York"], ["CT", "America/Chicago"], ["MT", "America/Denver"], ["PT", "America/Los_Angeles"]];

export function Clocks() {
  const [now, setNow] = useState<Date | null>(null);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), 30000);
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { clearInterval(tick); window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return (
    <div className="x-clocks">
      {now && ZONES.map(([label, timeZone]) => <span key={label}>{label} <b>{now.toLocaleTimeString("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</b></span>)}
      <span className="x-live" data-on={online}>{online ? "Live" : "Offline"}</span>
    </div>
  );
}

export function TopSearch() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Found[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); box.current?.focus(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    let live = true;
    if (q.trim().length < 2) { setItems([]); return; }
    const wait = setTimeout(() => globalSearch(q).then((r) => { if (live) setItems(r); }), 200);
    return () => { live = false; clearTimeout(wait); };
  }, [q]);
  return (
    <div className="x-search">
      <Search size={16} aria-hidden />
      <input ref={box} value={q} placeholder="Search stores and pages" aria-label="Search stores and pages" onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); box.current?.blur(); } }} />
      <kbd>⌘K</kbd>
      {open && q.trim().length >= 2 && (
        <div className="x-combo-list x-search-list">
          {items.map((i) => <Link key={i.href} href={i.href} onClick={() => { setOpen(false); setQ(""); }}>{i.label}<small>{i.note ?? i.kind}</small></Link>)}
          {!items.length && <p className="x-note" style={{ padding: "9px 12px" }}>No matches.</p>}
        </div>
      )}
    </div>
  );
}
