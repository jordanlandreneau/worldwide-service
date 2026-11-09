import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, Page } from "@/components/ui";
import { atLeast, requireUser } from "@/lib/access";
import { serviceAgents } from "@/lib/assignments";
import { db } from "@/lib/data";
import { workLists, type WorkList } from "@/lib/list-work";
import { showLocal } from "@/lib/scope";

export const metadata = { title: "My Work · Worldwide Service" };
const NY = "America/New_York";
const pct = (a: number, b: number) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
const dayKey = (at: string | Date, tz = NY) => new Date(at).toLocaleDateString("en-CA", { timeZone: tz });

function state(l: WorkList) {
  const worked = l.done + l.retry;
  if (l.done >= l.rows) return "finished";
  if (l.dueAt && new Date(l.dueAt).getTime() < Date.now()) return "overdue";
  if (l.dueAt && new Date(l.dueAt).getTime() - Date.now() < 86400000) return "soon";
  return worked ? "started" : "new";
}
const LABEL: Record<string, string> = { finished: "Finished", overdue: "Overdue", soon: "Due within a day", started: "In progress", new: "Not started" };

// Each agent's calling sheets: a calendar of due dates and a list to pick up where they left off.
// Managers and admins can look at any agent's work, or everyone's.
export default async function MyWork({ searchParams }: { searchParams: Promise<{ agent?: string; month?: string; show?: string }> }) {
  const user = await requireUser();
  const { agent = "", month = "", show = "" } = await searchParams;
  const lead = atLeast(user.role, "manager");
  const agents = lead ? await serviceAgents() : [];
  const viewing = lead && agent === "all" ? "all" : lead && /^[0-9a-f-]{36}$/i.test(agent) ? agent : user.id;
  let lists: WorkList[];
  if (viewing === "all") {
    const { data } = await db().from("list_assignments").select("list_id").limit(5000);
    lists = await workLists({ listIds: [...new Set(((data ?? []) as any[]).map((r) => r.list_id))] });
  } else lists = await workLists({ userId: viewing });
  const who = viewing === "all" ? "Everyone" : viewing === user.id ? "You" : agents.find((a) => a.id === viewing)?.name ?? "Agent";

  const order = { overdue: 0, soon: 1, started: 2, new: 3, finished: 4 } as Record<string, number>;
  const sorted = [...lists].sort((a, b) => order[state(a)] - order[state(b)] || (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9") || b.uploadedAt.localeCompare(a.uploadedAt));
  const open = sorted.filter((l) => state(l) !== "finished");
  const finished = sorted.filter((l) => state(l) === "finished");
  const left = open.reduce((n, l) => n + Math.max(0, l.rows - l.done - l.retry), 0);
  const callbacks = open.reduce((n, l) => n + l.retry, 0);
  const overdue = open.filter((l) => state(l) === "overdue").length;

  // Month calendar of due dates (Eastern time).
  const now = new Date();
  const [y, m] = /^\d{4}-\d{2}$/.test(month) ? month.split("-").map(Number) : [Number(dayKey(now).slice(0, 4)), Number(dayKey(now).slice(5, 7))];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead0 = first.getUTCDay();
  const ym = (yy: number, mm: number) => { const d = new Date(Date.UTC(yy, mm - 1, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
  const q = (extra: Record<string, string>) => `/my-work?${new URLSearchParams({ ...(agent ? { agent } : {}), ...(month ? { month } : {}), ...(show ? { show } : {}), ...extra })}`;
  const byDay = new Map<string, WorkList[]>();
  for (const l of lists) if (l.dueAt) { const k = dayKey(l.dueAt); byDay.set(k, [...(byDay.get(k) ?? []), l]); }
  const today = dayKey(now);
  const cells = [...Array(lead0).fill(null), ...Array.from({ length: days }, (_, i) => `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);

  const card = (l: WorkList) => {
    const st = state(l);
    const worked = l.done + l.retry;
    return (
      <li key={l.id} className="mw-card" data-state={st}>
        <div className="mw-card-top">
          <span className="mw-state">{LABEL[st]}</span>
          {l.dueAt && <span className="mw-due">Due {showLocal(l.dueAt, l.tz)}</span>}
        </div>
        <strong className="mw-store">{l.store}</strong>
        <span className="mw-file">{l.file}{l.campaign ? ` · ${l.campaign}` : ""}</span>
        <div className="mw-bar" aria-label={`${worked} of ${l.rows} worked`}><i style={{ width: `${pct(l.done, l.rows)}%` }} /><b style={{ width: `${pct(l.retry, l.rows)}%` }} /></div>
        <span className="mw-nums">{worked.toLocaleString()} of {l.rows.toLocaleString()} worked{l.retry ? ` · ${l.retry} to call back` : ""}</span>
        {viewing === "all" && <span className="mw-agents">{l.agents.map((a) => a.name).join(", ")}</span>}
        <Link className="x-btn x-btn-primary mw-go" href={`/my-work/list/${l.id}`}>{st === "finished" ? "Review" : worked ? "Continue" : "Start"}</Link>
      </li>
    );
  };

  return (
    <Page title={viewing === user.id ? "My Work" : `Work: ${who}`} subtitle="Calling sheets assigned to you, with their due dates. Pick up where you left off."
      actions={lead ? (
        <form className="x-filters">
          <select className="x-input" name="agent" defaultValue={viewing === user.id ? "" : viewing ?? ""} aria-label="Agent">
            <option value="">Me</option>
            <option value="all">Everyone</option>
            {agents.filter((a) => a.id !== user.id).map((a) => <option key={a.id} value={a.id}>{a.name}{a.team ? ` · ${a.team}` : ""}</option>)}
          </select>
          <button className="x-btn">View</button>
        </form>
      ) : undefined}>
      <div className="mw-stats">
        <div><strong>{open.length}</strong><span>open {open.length === 1 ? "list" : "lists"}</span></div>
        <div><strong>{left.toLocaleString()}</strong><span>customers not called yet</span></div>
        <div><strong>{callbacks.toLocaleString()}</strong><span>to call back</span></div>
        <div data-bad={overdue > 0}><strong>{overdue}</strong><span>overdue</span></div>
      </div>
      <div className="mw-grid">
        <Card title="Lists to work">
          {open.length ? <ul className="mw-cards">{open.map(card)}</ul> : <p className="text-sm text-ink-muted">{lists.length ? "Everything assigned is finished." : "No lists are assigned yet. A manager assigns them from the Command Center's Outbound Lists."}</p>}
          {finished.length > 0 && (
            show === "finished"
              ? <><h3 className="mw-h3">Finished</h3><ul className="mw-cards">{finished.map(card)}</ul></>
              : <p className="text-sm" style={{ marginTop: 10 }}><Link className="text-accent" href={q({ show: "finished" })}>Show {finished.length} finished</Link></p>
          )}
        </Card>
        <Card title={<span className="mw-cal-title"><CalendarDays size={16} aria-hidden /> {first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</span>}>
          <div className="mw-cal-nav">
            <Link className="x-btn" href={q({ month: ym(y, m - 1) })} aria-label="Previous month"><ChevronLeft size={16} /></Link>
            <Link className="x-btn" href={q({ month: "" })}>Today</Link>
            <Link className="x-btn" href={q({ month: ym(y, m + 1) })} aria-label="Next month"><ChevronRight size={16} /></Link>
          </div>
          <div className="mw-cal" role="grid">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="mw-dow">{d}</div>)}
            {cells.map((c, i) => (
              <div key={i} className={`mw-day${c === today ? " today" : ""}${c ? "" : " blank"}`}>
                {c && <span className="mw-num">{Number(c.slice(8))}</span>}
                {c && (byDay.get(c) ?? []).map((l) => <Link key={l.id} href={`/my-work/list/${l.id}`} className="mw-chip" data-state={state(l)} title={`${l.store} · ${l.file}`}>{l.store}</Link>)}
              </div>
            ))}
          </div>
          <p className="text-sm text-ink-muted" style={{ marginTop: 8 }}>Lists show on the day they&apos;re due (Eastern time). Lists without a due date are only in the list on the left.</p>
        </Card>
      </div>
    </Page>
  );
}
