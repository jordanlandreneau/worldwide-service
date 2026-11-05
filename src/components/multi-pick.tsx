"use client";
import { useState } from "react";

// Submits with its GET form as repeated values, and filters long lists as you type.
export function MultiPick({ name, label, all, options, selected }: { name: string; label: string; all: string; options: { value: string; label: string }[]; selected: string[] }) {
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState(selected);
  const shown = options.filter((o) => o.label.toLowerCase().includes(term.trim().toLowerCase()));
  const toggle = (v: string) => setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  const summary = picked.length === 0 ? all : picked.length === 1 ? options.find((o) => o.value === picked[0])?.label ?? "1 selected" : `${picked.length} selected`;
  return (
    <div className="x-field">
      <span>{label}</span>
      <details className="x-multi">
        <summary className="x-input">{summary}</summary>
        <div className="x-multi-pop">
          {options.length > 8 && <input className="x-input" placeholder="Type to search" aria-label={`Search ${label}`} value={term} onChange={(e) => setTerm(e.target.value)} />}
          <div className="x-multi-list">
            {shown.slice(0, 300).map((o) => <label key={o.value}><input type="checkbox" checked={picked.includes(o.value)} onChange={() => toggle(o.value)} /> {o.label}</label>)}
            {!shown.length && <p>No matches.</p>}
          </div>
        </div>
      </details>
      {picked.map((v) => <input key={v} type="hidden" name={name} value={v} />)}
    </div>
  );
}
