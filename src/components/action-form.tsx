"use client";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import type { Result } from "@/lib/manage";

type Action = (state: Result, form: FormData) => Promise<Result>;
export const fieldStyle = { display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 } as const;

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label style={fieldStyle}><span className="type-label text-ink-title">{label}</span>{children}</label>;
}

export function ModalForm({ button, title, note, action, submit = "Save", children }: { button: string; title: string; note?: string; action: Action; submit?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});
  useEffect(() => { if (state.ok) setOpen(false); }, [state]);
  return (
    <>
      <button type="button" className="x-btn" onClick={() => setOpen(true)}>{button}</button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={title} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <form action={formAction} className="box-border rounded-card border border-border bg-surface p-card" style={{ width: "min(480px, 100%)", maxHeight: "90vh", overflow: "auto" }}>
            <h2 className="text-card font-semibold text-ink-title" style={{ marginBottom: 6 }}>{title}</h2>
            {note && <p className="type-caption text-ink-muted" style={{ marginBottom: 14 }}>{note}</p>}
            {children}
            {state.error && <p role="alert" className="text-sm text-status-attention-ink" style={{ marginBottom: 10 }}>{state.error}</p>}
            <div className="x-filters" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="x-btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="x-btn x-btn-primary" disabled={pending}>{pending ? "…" : submit}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export function InlineForm({ action, submit = "Save", children, extra }: { action: Action; submit?: string; children: ReactNode; extra?: ReactNode }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction}>
      {children}
      {state.error && <p role="alert" className="text-sm text-status-attention-ink" style={{ marginBottom: 10 }}>{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-ink-muted" style={{ marginBottom: 10 }}>Saved.</p>}
      <div className="x-filters"><button className="x-btn x-btn-primary" disabled={pending}>{pending ? "…" : submit}</button>{extra}</div>
    </form>
  );
}

export function ActionButton({ action, label, confirm }: { action: () => Promise<void>; label: string; confirm?: string }) {
  return (
    <form action={action} onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }} style={{ display: "inline" }}>
      <button className="x-btn">{label}</button>
    </form>
  );
}
