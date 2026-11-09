import type { ReactNode } from "react";

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="x-page">
      <div className="x-page-head">
        <div className="min-w-0 flex-1">
          <h1 className="x-title">{title}</h1>
          {subtitle && <p className="x-subtitle">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className="x-stack">{children}</div>
    </div>
  );
}

export function Card({ title, note, children }: { title?: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="x-card">
      {title && (
        <header className="x-card-head">
          <h2>{title}</h2>
          {note && <p>{note}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Table({ head, rows, empty = "Nothing to show." }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-ink-muted">{empty}</p>;
  return (
    <div className="x-table-wrap">
      <table className="x-table">
        <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function Status({ value }: { value: string | boolean | null | undefined }) {
  const active = value === true || value === "Active";
  const label = typeof value === "string" ? value : active ? "Active" : "Inactive";
  return (
    <span className={`box-border inline-flex h-chip flex-none items-center gap-1.5 whitespace-nowrap rounded-full py-0 pl-2 pr-2.5 font-medium ${active ? "bg-good-fill text-good-ink" : "bg-surface-fill text-ink-muted"}`}>
      <span aria-hidden className={`size-[5px] flex-none rounded-full ${active ? "bg-good" : "bg-ink-muted"}`} />{label}
    </span>
  );
}

export function Field({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="x-dl">
      {items.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt className="text-ink-muted">{k}</dt>
          <dd className="min-w-0 text-ink-title" style={{ margin: 0, overflowWrap: "anywhere" }}>{v === null || v === undefined || v === "" ? "—" : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function External({ href }: { href?: string | null }) {
  if (!href) return <>—</>;
  const safe = /^https?:\/\//i.test(href) ? href : `https://${href}`;
  return <a href={safe} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">{href}</a>;
}
