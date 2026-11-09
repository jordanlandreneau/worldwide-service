"use client";
import { useActionState, useEffect, useState } from "react";
import type { Result } from "@/lib/manage";

type Row = { label: string; value: string };

// A section only this store has: a name and any number of question / answer rows.
export function StoreSectionForm({ action, initial, onDone }: { action: (s: Result, f: FormData) => Promise<Result>; initial?: { title: string; rows: Row[] }; onDone?: () => void }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [title, setTitle] = useState(initial?.title ?? "");
  const [rows, setRows] = useState<Row[]>(initial?.rows.length ? initial.rows : [{ label: "", value: "" }]);
  useEffect(() => { if (state.ok) onDone?.(); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <form action={formAction} className="ss-form">
      <label className="ss-label">Section name
        <input className="x-input" name="title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Tire center, Detail shop, Holiday hours" />
      </label>
      <div className="ss-rows">
        <div className="ss-row ss-head"><span>Question or label</span><span>Answer</span><span /></div>
        {rows.map((r, i) => (
          <div key={i} className="ss-row">
            <input className="x-input" name={`label_${i}`} value={r.label} onChange={(e) => set(i, "label", e.target.value)} placeholder="e.g. Tire brands" aria-label={`Question ${i + 1}`} />
            <textarea className="x-input" name={`value_${i}`} rows={1} value={r.value} onChange={(e) => set(i, "value", e.target.value)} placeholder="e.g. Michelin, Goodyear" aria-label={`Answer ${i + 1}`} />
            <button type="button" className="x-btn" onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ label: "", value: "" }])} aria-label={`Remove row ${i + 1}`}>✕</button>
          </div>
        ))}
        <button type="button" className="x-btn" onClick={() => setRows([...rows, { label: "", value: "" }])}>+ Add a row</button>
      </div>
      {state.error && <p role="alert" className="text-sm" style={{ color: "#b42318" }}>{state.error}</p>}
      {state.ok && <p role="status" className="text-sm" style={{ color: "#15803d" }}>Saved.</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="x-btn x-btn-primary" disabled={pending}>{pending ? "Saving…" : "Save section"}</button>
      </div>
    </form>
  );
}
