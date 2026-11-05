import type { ReactNode } from "react";
import Link from "next/link";
import { PRESETS } from "@/lib/report";

export function RangeFields({ preset, from, to }: { preset: string; from: string; to: string }) {
  return (
    <>
      <label className="x-field"><span>Date range</span><select className="x-input" name="range" defaultValue={preset}>{PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="x-field"><span>From (custom)</span><input className="x-input" type="date" name="from" defaultValue={from} /></label>
      <label className="x-field"><span>To (custom)</span><input className="x-input" type="date" name="to" defaultValue={to} /></label>
    </>
  );
}
export const Stats = ({ items }: { items: [string, ReactNode, string?][] }) => (
  <div className="x-stats">{items.map(([k, v, n]) => <div className="x-stat" key={k}><span>{k}</span><strong>{v}</strong>{n && <small>{n}</small>}</div>)}</div>
);
export const Pager = ({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) => pages <= 1 ? null : (
  <div className="x-filters" style={{ marginTop: 12, justifyContent: "flex-end" }}>
    {page > 1 && <Link className="x-btn" href={href(page - 1)} style={{ display: "inline-flex", alignItems: "center" }}>Previous</Link>}
    <span className="text-sm text-ink-muted">Page {page} of {pages}</span>
    {page < pages && <Link className="x-btn" href={href(page + 1)} style={{ display: "inline-flex", alignItems: "center" }}>Next</Link>}
  </div>
);
export function query(params: Record<string, string | string[] | undefined>, extra: Record<string, string> = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const x of Array.isArray(v) ? v : v ? [v] : []) q.append(k, x);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}
