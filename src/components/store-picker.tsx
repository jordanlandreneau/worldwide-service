"use client";
import { useMemo, useState } from "react";
import Link from "next/link";

export function StorePicker({ base, stores, selected }: { base: string; stores: { id: string; name: string }[]; selected?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const list = useMemo(() => stores.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 60), [q, stores]);
  return (
    <div className="x-combo">
      <input
        className="x-input" style={{ width: "100%" }} aria-label="Select dealership"
        placeholder={selected ?? "Search dealerships…"} value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="x-combo-list">
          {list.map((s) => <Link key={s.id} href={`${base}?d=${s.id}`} onClick={() => { setOpen(false); setQ(""); }}>{s.name}</Link>)}
          {!list.length && <p className="text-sm text-ink-muted" style={{ padding: "8px 12px" }}>No dealerships match.</p>}
        </div>
      )}
    </div>
  );
}
