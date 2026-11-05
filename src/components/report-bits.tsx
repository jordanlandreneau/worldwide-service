import Link from "next/link";

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
