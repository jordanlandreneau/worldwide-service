import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Page } from "@/components/ui";
import { atLeast, requireUser } from "@/lib/access";
import { db } from "@/lib/data";
import { clearRow, markRow } from "@/lib/list-actions";
import { OUTCOMES, outcome, RETRY } from "@/lib/list-status";
import { workLists } from "@/lib/list-work";
import { showLocal } from "@/lib/scope";

export const metadata = { title: "Calling sheet · Worldwide Service" };
const PER = 25;
const VIEWS = [["todo", "To do"], ["callback", "Call back"], ["done", "Done"], ["all", "All"]] as const;
const PHONE = /phone|cell|mobile|tel|number/i;
const when = (v: string) => new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

// One calling sheet, worked customer by customer. "To do" always starts at the first customer
// nobody has called yet, so opening the sheet again continues where the agent left off.
export default async function WorkList({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string; page?: string; q?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { view: rawView = "todo", page = "1", q = "" } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const client = db();
  const [meta] = await workLists({ listIds: [id] });
  if (!meta) notFound();
  const lead = atLeast(user.role, "manager");
  if (!lead && !meta.agents.some((a) => a.id === user.id)) {
    return <Page title="Calling sheet"><Card><p className="text-sm">This list isn&apos;t assigned to you. Ask a manager to add you to it in the Command Center.</p></Card></Page>;
  }
  const [{ data: list }, progress] = await Promise.all([
    client.from("outbound_lists").select("columns,rows,campaign_id,note").eq("id", id).maybeSingle(),
    (async () => {
      const out = new Map<number, any>();
      for (let from = 0; ; from += 1000) {
        const { data } = await client.from("list_progress").select("row_index,status,note,user_name,updated_at").eq("list_id", id).range(from, from + 999);
        for (const r of (data ?? []) as any[]) out.set(r.row_index, r);
        if ((data ?? []).length < 1000) break;
      }
      return out;
    })(),
  ]);
  if (!list) notFound();
  const columns = (list.columns ?? []) as string[];
  const rows = (list.rows ?? []) as string[][];
  const view = VIEWS.some(([k]) => k === rawView) ? rawView : "todo";
  const term = q.trim().toLowerCase();
  const match = (i: number) => {
    const p = progress.get(i);
    if (view === "todo" && p) return false;
    if (view === "callback" && !(p && RETRY.has(p.status))) return false;
    if (view === "done" && !(p && !RETRY.has(p.status))) return false;
    return !term || rows[i].some((c) => String(c ?? "").toLowerCase().includes(term));
  };
  const idx = rows.map((_, i) => i).filter(match);
  const pages = Math.max(1, Math.ceil(idx.length / PER));
  const current = Math.min(pages, Math.max(1, Number(page) || 1));
  const shown = idx.slice((current - 1) * PER, current * PER);
  const counts = { todo: rows.length - progress.size, callback: [...progress.values()].filter((p) => RETRY.has(p.status)).length, done: [...progress.values()].filter((p) => !RETRY.has(p.status)).length, all: rows.length } as Record<string, number>;
  const tally = new Map<string, number>();
  for (const p of progress.values()) tally.set(p.status, (tally.get(p.status) ?? 0) + 1);
  const link = (extra: Record<string, string>) => `/my-work/list/${id}?${new URLSearchParams({ view, ...(q ? { q } : {}), ...extra })}`;
  const worked = meta.done + meta.retry;
  const pct = (a: number) => (meta.rows ? Math.round((a / meta.rows) * 100) : 0);
  const appt = `/appointments?d=${meta.storeId}${list.campaign_id ? `&campaign=${list.campaign_id}` : ""}#set`;

  return (
    <Page title={meta.store} subtitle={<>{meta.file}{meta.campaign ? ` · ${meta.campaign}` : ""}{meta.dueAt ? <> · <strong>Due {showLocal(meta.dueAt, meta.tz)}</strong></> : ""} · {meta.agents.map((a) => a.name).join(", ") || "No agents"}</>}
      actions={<span className="x-filters">
        <Link className="x-btn" href="/my-work" style={{ display: "inline-flex", alignItems: "center" }}>My Work</Link>
        <Link className="x-btn" href={`/service/info?d=${meta.storeId}`} style={{ display: "inline-flex", alignItems: "center" }}>Service Data</Link>
        <a className="x-btn" href={`/command-lists/${id}`} style={{ display: "inline-flex", alignItems: "center" }}>Download CSV</a>
      </span>}>
      <Card>
        <div className="wl-progress">
          <div className="mw-bar big"><i style={{ width: `${pct(meta.done)}%` }} /><b style={{ width: `${pct(meta.retry)}%` }} /></div>
          <span><strong>{worked.toLocaleString()}</strong> of {meta.rows.toLocaleString()} worked ({pct(worked)}%)</span>
        </div>
        <div className="wl-tally">{OUTCOMES.filter((o) => tally.get(o.value)).map((o) => <span key={o.value} className="cc-badge" data-tone={o.tone}>{o.label}: {tally.get(o.value)}</span>)}</div>
        {list.note && <p className="text-sm text-ink-muted" style={{ marginTop: 6 }}>Note: {list.note}</p>}
      </Card>
      <nav className="cc-tabs" role="tablist">
        {VIEWS.map(([k, label]) => <Link key={k} role="tab" aria-selected={view === k} data-active={view === k} href={`/my-work/list/${id}?${new URLSearchParams({ view: k, ...(q ? { q } : {}) })}`}>{label} ({counts[k].toLocaleString()})</Link>)}
      </nav>
      <form className="x-filters">
        <input type="hidden" name="view" value={view} />
        <input className="x-input" name="q" defaultValue={q} placeholder="Search name, phone, vehicle…" aria-label="Search this list" style={{ minWidth: 260 }} />
        <button className="x-btn">Search</button>
        {q && <Link className="x-btn" href={`/my-work/list/${id}?view=${view}`} style={{ display: "inline-flex", alignItems: "center" }}>Clear</Link>}
      </form>
      {!shown.length && <Card><p className="text-sm text-ink-muted">{view === "todo" && !term ? "Everyone on this list has been called. Check Call back for the ones to try again." : "Nothing here."}</p></Card>}
      <ol className="wl-rows">
        {shown.map((i) => {
          const p = progress.get(i);
          const o = outcome(p?.status);
          return (
            <li key={i} className="wl-row" data-done={!!p}>
              <div className="wl-n">#{i + 1}</div>
              <dl className="wl-fields">
                {columns.map((c, k) => {
                  const v = String(rows[i][k] ?? "").trim();
                  if (!v) return null;
                  const tel = PHONE.test(c) && v.replace(/\D/g, "").length >= 10;
                  return <div key={k}><dt>{c}</dt><dd>{tel ? <a href={`tel:${v.replace(/[^\d+]/g, "")}`} className="text-accent">{v}</a> : v}</dd></div>;
                })}
              </dl>
              <form action={markRow.bind(null, id, i)} className="wl-act">
                {p && <p className="wl-last"><span className="cc-badge" data-tone={o?.tone ?? "slate"}>{o?.label ?? p.status.replace(/_/g, " ").toUpperCase()}</span> {p.user_name ?? ""} · {when(p.updated_at)}{p.note ? <em> “{p.note}”</em> : null}</p>}
                <input className="x-input" name="note" placeholder="Note (optional)" defaultValue="" maxLength={1000} />
                <div className="wl-buttons">
                  {OUTCOMES.map((x) => <button key={x.value} name="status" value={x.value} className="wl-out" data-tone={x.tone}>{x.label}</button>)}
                </div>
                <div className="wl-more">
                  <Link href={appt} className="text-accent">Set the appointment →</Link>
                  {p && <button formAction={clearRow.bind(null, id, i)} className="wl-clear">Undo outcome</button>}
                </div>
              </form>
            </li>
          );
        })}
      </ol>
      {pages > 1 && (
        <div className="x-filters">
          {current > 1 && <Link className="x-btn" href={link({ page: String(current - 1) })} style={{ display: "inline-flex", alignItems: "center" }}>Previous</Link>}
          <span className="text-sm">Page {current} of {pages}</span>
          {current < pages && <Link className="x-btn" href={link({ page: String(current + 1) })} style={{ display: "inline-flex", alignItems: "center" }}>Next</Link>}
        </div>
      )}
    </Page>
  );
}
