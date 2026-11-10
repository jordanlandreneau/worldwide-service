import Link from "next/link";
import type { ReactNode } from "react";
import { AlarmClock, BarChart3, CalendarDays, Check, CheckCheck, ClipboardList, Clock, FileSpreadsheet, KeyRound, Layers, PhoneCall, Plus, ShieldCheck, Upload, UserRound, Users, Headphones, PhoneIncoming, PhoneOutgoing, Signal } from "lucide-react";
import { ActionButton, Field, InlineForm, ModalForm } from "@/components/action-form";
import { StorePicker } from "@/components/store-picker";
import { Card, Table } from "@/components/ui";
import { addStat, updateStat, deleteCampaign, deleteList, deleteStat, saveCampaign, setListTask, toggleWave, uploadList } from "@/lib/command";
import { assignmentsFor, serviceAgents, type Agent } from "@/lib/assignments";
import { progressFor } from "@/lib/list-work";
import { db, fetchAll } from "@/lib/data";
import { atLeast } from "@/lib/access";
import { localParts, localToUtc, requireScoped, showLocal } from "@/lib/scope";
import { storeCalls } from "@/lib/calls";

export const metadata = { title: "Command Center · Worldwide Service" };

type Campaign = {
  id: string; category: string; name: string; description: string | null; cadence: string | null; list_ref: string | null;
  launch_date: string | null; wave1_done: boolean; wave2_done: boolean; script: string | null; info: string | null; sort_order: number; due_at: string | null; assigned_to: string | null;
};
type Stat = { id: string; campaign_id: string; stat_date: string; calls_made: number; calls_connected: number; appointments_set: number; notes: string | null; entered_by: string };
type List = { id: string; campaign_id: string | null; file_name: string; row_count: number; note: string | null; uploaded_by: string; uploaded_at: string; due_at: string | null; assigned_to: string | null };

const TABS = [["matrix", "Category Matrix", Layers], ["analytics", "Progress Analytics", BarChart3], ["breakdown", "Analytics Breakdown", ClipboardList], ["lists", "Outbound Lists", FileSpreadsheet], ["calls", "Call Recordings", Headphones]] as const;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const daily = (c: Campaign) => /daily/i.test(c.cadence ?? "");
const when = (v: string) => new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const day = (v: string) => new Date(`${v}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

function StatCard({ label, icon, value, of, unit, note, tone, bar }: { label: string; icon: ReactNode; value: number; of?: number; unit?: string; note: string; tone: string; bar: number }) {
  return (
    <div className="cc-stat" data-tone={tone}>
      <div className="cc-stat-head"><span>{label}</span>{icon}</div>
      <div className="cc-stat-value"><strong>{value.toLocaleString()}{unit}</strong>{of !== undefined && <small>/ {of}</small>}</div>
      <p>{note}</p>
      <div className="cc-bar"><i style={{ width: `${Math.min(100, Math.max(0, bar))}%` }} /></div>
    </div>
  );
}

// Deadline and agents for one calling sheet (CSV). Times are the store's local time.
type TaskCtx = { tz: string; agents: Agent[]; canAssign: boolean };
function TaskFields({ dueAt, assigned = [], ctx }: { dueAt?: string | null; assigned?: string[]; ctx: TaskCtx }) {
  const local = dueAt ? localParts(dueAt, ctx.tz) : null;
  const zone = new Date().toLocaleTimeString("en-US", { timeZone: ctx.tz, timeZoneName: "short" }).split(" ").pop();
  const on = new Set(assigned);
  const teams = [...new Set(ctx.agents.map((a) => a.team ?? "No team"))].sort();
  return (
    <>
      <div className="cc-form-grid">
        <Field label="List due date (optional)"><input className="x-input" type="date" name="due_date" defaultValue={local?.date ?? ""} /></Field>
        <Field label={`Due time (${zone}, store time)`}><input className="x-input" type="time" name="due_time" defaultValue={local?.time ?? "17:00"} /></Field>
      </div>
      {ctx.canAssign && (
        <fieldset className="cc-agents">
          <legend>Agents working this list (optional)</legend>
          {teams.map((t) => (
            <div key={t} className="cc-agents-team">
              <small>{t}</small>
              {ctx.agents.filter((a) => (a.team ?? "No team") === t).map((a) => (
                <label key={a.id}><input type="checkbox" name="agents" value={a.id} defaultChecked={on.has(a.id)} /> {a.name}</label>
              ))}
            </div>
          ))}
        </fieldset>
      )}
    </>
  );
}

function DueBadge({ at, done, tz }: { at: string | null; done?: boolean; tz: string }) {
  if (!at) return null;
  const late = !done && new Date(at).getTime() < Date.now();
  const soon = !done && !late && new Date(at).getTime() - Date.now() < 86400000;
  return <span className="cc-badge" data-tone={done ? "green" : late ? "red" : soon ? "amber" : "slate"} title={late ? "Past due" : undefined}><AlarmClock size={13} aria-hidden /> {late ? "Overdue · " : done ? "Done · " : "Due "}{showLocal(at, tz)}</span>;
}

function CampaignFields({ c, category, categories, ctx }: { c?: Campaign; category?: string; categories: string[]; ctx: TaskCtx }) {
  const input = (name: string, label: string, value?: string | null, placeholder?: string) => <Field label={label}><input className="x-input" name={name} defaultValue={value ?? ""} placeholder={placeholder} /></Field>;
  const area = (name: string, label: string, value?: string | null) => <Field label={label}><textarea className="x-input" name={name} defaultValue={value ?? ""} style={{ height: 110, padding: 10 }} /></Field>;
  return (
    <>
      <Field label="Category">
        <input className="x-input" name="category" required list="cc-categories" defaultValue={c?.category ?? category ?? ""} placeholder="e.g. Recalls, CSSR: Service Reminders" />
        <datalist id="cc-categories">{categories.map((x) => <option key={x} value={x} />)}</datalist>
      </Field>
      {input("name", "Campaign", c?.name, "e.g. Missed Appointments")}
      {input("description", "Call description", c?.description)}
      {input("cadence", "Cadence", c?.cadence, "e.g. 500, DAILY, Weekly")}
      {input("list_ref", "List / sheet", c?.list_ref, "Where the list comes from")}
      {input("launch_date", "Launch date", c?.launch_date, "e.g. November 4th")}
      {area("script", "Script", c?.script)}
      {area("info", "Information", c?.info)}
      <Field label={c ? "Add a CSV list (optional)" : "CSV list (optional)"}><input className="x-input" type="file" name="file" accept=".csv,text/csv" style={{ paddingTop: 8 }} /></Field>
      <Field label="List note (optional)"><input className="x-input" name="list_note" placeholder="e.g. November recall list" /></Field>
      <p className="text-sm text-ink-muted" style={{ margin: "-4px 0 8px" }}>The due date and agents below apply to this CSV only.</p>
      <TaskFields ctx={ctx} />
    </>
  );
}

export default async function CommandCenter({ searchParams }: { searchParams: Promise<{ d?: string; tab?: string; q?: string; cat?: string; status?: string; from?: string; to?: string; campaign?: string; dir?: string; agent?: string; result?: string; page?: string }> }) {
  const { user, stores: scope } = await requireScoped();
  const { d, tab: rawTab = "matrix", q = "", cat = "", status = "", from = "", to = "", campaign: pick = "", dir = "", agent: agentPick = "", result = "", page: pageParam = "1" } = await searchParams;
  const tab = TABS.some(([k]) => k === rawTab) ? rawTab : "matrix";
  const stores = (await fetchAll<any>("dealerships", "id,name,active,timezone", "name")).filter((s: any) => s.active !== false && (scope === null || scope.includes(s.id))) as { id: string; name: string; timezone: string | null }[];
  const store = stores.find((s) => s.id === d) ?? stores[0];
  // staff = can edit campaigns, mark waves and enter analytics (managers and admins).
  const staff = atLeast(user.role, "manager");
  const worldwide = user.role !== "dealership";
  const canUpload = !worldwide || staff;

  if (!store) {
    return <div className="x-page"><Card><p className="text-sm text-ink-muted">No stores are assigned to your login yet. Ask Worldwide BDC to add your store.</p></Card></div>;
  }

  const tz = store.timezone || "America/New_York";
  const client = db();
  const [{ data: c1 }, { data: s1 }, { data: l1 }, agents, assigned] = await Promise.all([
    client.from("campaigns").select("id,category,name,description,cadence,list_ref,launch_date,wave1_done,wave2_done,script,info,sort_order,due_at,assigned_to").eq("dealership_id", store.id).order("category").order("sort_order").order("created_at"),
    client.from("campaign_stats").select("id,campaign_id,stat_date,calls_made,calls_connected,appointments_set,notes,entered_by").eq("dealership_id", store.id).order("stat_date", { ascending: false }).order("created_at", { ascending: false }).limit(2000),
    client.from("outbound_lists").select("id,campaign_id,file_name,row_count,note,uploaded_by,uploaded_at,due_at,assigned_to").eq("dealership_id", store.id).order("uploaded_at", { ascending: false }).limit(200),
    worldwide ? serviceAgents() : Promise.resolve([] as Agent[]),
    worldwide ? assignmentsFor(store.id) : Promise.resolve([]),
  ]);
  const ctx: TaskCtx = { tz, agents, canAssign: staff };
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const campaigns = (c1 ?? []) as Campaign[];
  const stats = (s1 ?? []) as Stat[];
  const lists = (l1 ?? []) as List[];
  // Who works each sheet, and how many of its customers have an outcome.
  const listIds = lists.map((l) => l.id);
  const [{ data: la }, prog] = await Promise.all([
    listIds.length ? client.from("list_assignments").select("list_id,user_id").in("list_id", listIds) : Promise.resolve({ data: [] }),
    progressFor(listIds),
  ]);
  const listAgents = new Map<string, { id: string; name: string }[]>();
  for (const r of (la ?? []) as any[]) listAgents.set(r.list_id, [...(listAgents.get(r.list_id) ?? []), { id: r.user_id, name: String(agentName.get(r.user_id) ?? "Agent") }]);
  const listDone = new Map([...prog.entries()].map(([k, v]) => [k, v.done + v.retry]));
  const categories = [...new Set(campaigns.map((c) => c.category))];
  const names = new Map(campaigns.map((c) => [c.id, c.name]));
  const href = (extra: Record<string, string>) => `/command?${new URLSearchParams({ d: store.id, tab, ...extra })}`;

  const total = campaigns.length;
  const w1 = campaigns.filter((c) => c.wave1_done).length;
  const w2 = campaigns.filter((c) => c.wave2_done).length;
  const both = campaigns.filter((c) => c.wave1_done && c.wave2_done).length;
  const half = campaigns.filter((c) => c.wave1_done !== c.wave2_done).length;
  const dailies = campaigns.filter(daily);
  const dailyDone = dailies.filter((c) => c.wave1_done && c.wave2_done).length;

  let body: ReactNode = null;
  if (tab === "matrix") {
    const term = q.trim().toLowerCase();
    const shown = campaigns
      .filter((c) => !cat || c.category === cat)
      .filter((c) => status === "open" ? !(c.wave1_done && c.wave2_done) : status === "done" ? c.wave1_done && c.wave2_done : status === "w1" ? c.wave1_done && !c.wave2_done : true)
      .filter((c) => !term || [c.name, c.category, c.description, c.list_ref, c.cadence, c.info].some((v) => (v ?? "").toLowerCase().includes(term)));
    const groups = categories.map((k) => [k, shown.filter((c) => c.category === k)] as const).filter(([, list]) => list.length > 0 || (!term && !status && !cat));
    const myLists = lists.filter((l) => user.id && (listAgents.get(l.id) ?? []).some((a) => a.id === user.id));
    const upcoming = [
      ...lists.filter((l) => l.due_at && (listDone.get(l.id) ?? 0) < l.row_count).map((l) => ({ key: l.id, at: l.due_at as string, label: `${l.file_name}${l.campaign_id ? ` · ${names.get(l.campaign_id) ?? ""}` : ""}`, owner: (listAgents.get(l.id) ?? []).map((a) => a.name).join(", ") || null, href: worldwide ? `/my-work/list/${l.id}` : `/command-lists/${l.id}` })),
    ].filter((x) => new Date(x.at).getTime() > Date.now() - 7 * 86400000).sort((a, b) => a.at.localeCompare(b.at)).slice(0, 8);
    body = (
      <>
        <form className="cc-filters">
          <input type="hidden" name="d" value={store.id} />
          <input type="hidden" name="tab" value="matrix" />
          <input className="x-input cc-search" name="q" defaultValue={q} placeholder="Search segment, list, notes…" aria-label="Search" />
          <label>Category <select className="x-input" name="cat" defaultValue={cat}><option value="">All Categories ({categories.length})</option>{categories.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
          <label>Status <select className="x-input" name="status" defaultValue={status}><option value="">All Items</option><option value="open">Not finished</option><option value="w1">Wave 1 only</option><option value="done">Both waves done</option></select></label>
          <button className="x-btn">Apply</button>
        </form>
        {myLists.length > 0 && (
          <div className="cc-mine" role="note">
            <UserRound size={16} aria-hidden />
            <span><strong>Assigned to you:</strong> {myLists.length} calling {myLists.length === 1 ? "sheet" : "sheets"} at this store.</span>
            <Link className="x-btn" href="/my-work">Open My Work</Link>
          </div>
        )}
        {upcoming.length > 0 && (
          <Card title="List deadlines" note={`Store time (${tz.replace(/_/g, " ")}). A list drops off once every customer on it has an outcome.`}>
            <ul className="cc-deadlines">
              {upcoming.map((x) => {
                const late = new Date(x.at).getTime() < Date.now();
                return <li key={x.key} data-late={late}><a href={x.href}>{x.label}</a><span>{x.owner ?? "Unassigned"}</span><DueBadge at={x.at} tz={tz} /></li>;
              })}
            </ul>
          </Card>
        )}
        {!campaigns.length && <Card><p className="text-sm text-ink-muted">{staff ? "No campaigns yet. Use New Campaign Task to add the first one." : "No campaigns have been set up for this store yet."}</p></Card>}
        {groups.map(([k, list]) => {
          const all = campaigns.filter((c) => c.category === k);
          return (
            <section key={k} className="cc-group">
              <header>
                <span className="cc-group-name">{k}</span>
                <span className="cc-chip">{all.length} {all.length === 1 ? "task" : "tasks"}</span>
                <span className="cc-group-tally">W1: <b data-tone="green">{all.filter((c) => c.wave1_done).length}/{all.length}</b> | W2: <b data-tone="blue">{all.filter((c) => c.wave2_done).length}/{all.length}</b></span>
                {staff && <span className="cc-add"><ModalForm button="+ Add Row" title={`Add to ${k}`} submit="Add" action={saveCampaign.bind(null, store.id, null)}><CampaignFields category={k} categories={categories} ctx={ctx} /></ModalForm></span>}
              </header>
              {list.map((c) => (
                <div key={c.id} className="cc-row">
                  <div className="cc-row-main">
                    <div className="cc-row-title">
                      <strong>{c.name}</strong>
                      {c.cadence && <span className="cc-badge" data-tone="amber">Cadence: {c.cadence}</span>}
                      {c.launch_date && <span className="cc-badge" data-tone="blue"><CalendarDays size={13} aria-hidden /> {c.launch_date}</span>}
                    </div>
                    {(c.description || c.list_ref) && (
                      <p className="cc-row-meta">
                        {c.description && <><span>Desc:</span> {c.description}</>}
                        {c.list_ref && <><span>List/Sheet:</span> {c.list_ref}</>}
                      </p>
                    )}
                    {lists.some((l) => l.campaign_id === c.id) && (
                      <p className="cc-row-meta">
                        <span>Lists:</span>{" "}
                        {lists.filter((l) => l.campaign_id === c.id).map((l, i) => <span key={l.id}>{i > 0 && " · "}<a className="text-accent" href={worldwide ? `/my-work/list/${l.id}` : `/command-lists/${l.id}`}>{l.file_name}</a> ({(listDone.get(l.id) ?? 0).toLocaleString()}/{l.row_count.toLocaleString()} worked{(listAgents.get(l.id) ?? []).length ? ` · ${(listAgents.get(l.id) ?? []).map((a) => a.name).join(", ")}` : ""}){l.due_at && <> <DueBadge at={l.due_at} done={(listDone.get(l.id) ?? 0) >= l.row_count} tz={tz} /></>}</span>)}
                      </p>
                    )}
                    {(c.script || c.info) && (
                      <details className="cc-more">
                        <summary>Script &amp; information</summary>
                        {c.script && <div><h4>Script</h4><p className="x-prewrap">{c.script}</p></div>}
                        {c.info && <div><h4>Information</h4><p className="x-prewrap">{c.info}</p></div>}
                      </details>
                    )}
                  </div>
                  <div className="cc-row-actions">
                    {staff ? (
                      <>
                        <form action={toggleWave.bind(null, store.id, c.id, 1)}><button className="cc-wave" data-wave="1" data-on={c.wave1_done} aria-pressed={c.wave1_done}>{c.wave1_done ? <Check size={15} aria-hidden /> : <span className="cc-dot" aria-hidden />} Wave 1</button></form>
                        <form action={toggleWave.bind(null, store.id, c.id, 2)}><button className="cc-wave" data-wave="2" data-on={c.wave2_done} aria-pressed={c.wave2_done}>{c.wave2_done ? <Check size={15} aria-hidden /> : <span className="cc-dot" aria-hidden />} Wave 2</button></form>
                        <span className="cc-sep" aria-hidden />
                        {worldwide && <Link className="x-btn" href={`/appointments?d=${store.id}&campaign=${c.id}#set`} style={{ display: "inline-flex", alignItems: "center" }}>Set appointment</Link>}
                        <ModalForm button="Upload CSV" title={`Upload a list to ${c.name}`} note="A CSV file with a header row. Up to 20,000 rows." submit="Upload" action={uploadList.bind(null, store.id)}><input type="hidden" name="campaign_id" value={c.id} /><Field label="CSV file"><input className="x-input" type="file" name="file" accept=".csv,text/csv" required style={{ paddingTop: 8 }} /></Field><Field label="Note (optional)"><input className="x-input" name="note" /></Field><TaskFields ctx={ctx} /></ModalForm>
                        <ModalForm button="Edit" title={`Edit ${c.name}`} action={saveCampaign.bind(null, store.id, c.id)}><CampaignFields c={c} categories={categories} ctx={ctx} /></ModalForm>
                        <ActionButton label="Delete" confirm={`Delete ${c.name}? Its analytics entries are deleted too.`} action={deleteCampaign.bind(null, store.id, c.id)} />
                      </>
                    ) : (
                      <>
                        <span className="cc-wave" data-wave="1" data-on={c.wave1_done}>{c.wave1_done ? <Check size={15} aria-hidden /> : <span className="cc-dot" aria-hidden />} Wave 1</span>
                        <span className="cc-wave" data-wave="2" data-on={c.wave2_done}>{c.wave2_done ? <Check size={15} aria-hidden /> : <span className="cc-dot" aria-hidden />} Wave 2</span>
                        {worldwide && <><span className="cc-sep" aria-hidden />{worldwide && <Link className="x-btn" href={`/appointments?d=${store.id}&campaign=${c.id}#set`} style={{ display: "inline-flex", alignItems: "center" }}>Set appointment</Link>}</>}
                        {canUpload && <><span className="cc-sep" aria-hidden /><ModalForm button="Upload CSV" title={`Upload a list to ${c.name}`} note="A CSV file with a header row. Up to 20,000 rows." submit="Upload" action={uploadList.bind(null, store.id)}><input type="hidden" name="campaign_id" value={c.id} /><Field label="CSV file"><input className="x-input" type="file" name="file" accept=".csv,text/csv" required style={{ paddingTop: 8 }} /></Field><Field label="Note (optional)"><input className="x-input" name="note" /></Field><TaskFields ctx={ctx} /></ModalForm></>}
                      </>
                    )}
                  </div>
                </div>
              ))}
              {!list.length && <p className="cc-empty">No campaigns match the filters.</p>}
            </section>
          );
        })}
      </>
    );
  }

  if (tab === "analytics") {
    const chosen = campaigns.find((c) => c.id === pick) ?? null;
    const inRange = stats.filter((s) => (!from || s.stat_date >= from) && (!to || s.stat_date <= to));
    // Appointments overall: the counts entered in the Analytics Breakdown plus the ones set on the Appointments page.
    const { data: a1 } = await client.from("appointments").select("campaign_id,created_at").eq("dealership_id", store.id).neq("status", "cancelled").limit(20000);
    const setOn = ((a1 ?? []) as { campaign_id: string | null; created_at: string }[]).map((a) => ({ campaign_id: a.campaign_id, day: new Date(a.created_at).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) }));
    const setInRange = setOn.filter((a) => (!from || a.day >= from) && (!to || a.day <= to));
    type Tally = { calls: number; connected: number; entered: number; site: number; last: string | null };
    const per = new Map<string, Tally>();
    const tally = (id: string) => { let t = per.get(id); if (!t) { t = { calls: 0, connected: 0, entered: 0, site: 0, last: null }; per.set(id, t); } return t; };
    for (const s of inRange) { const t = tally(s.campaign_id); t.calls += s.calls_made; t.connected += s.calls_connected ?? 0; t.entered += s.appointments_set; if (!t.last || s.stat_date > t.last) t.last = s.stat_date; }
    for (const a of setInRange) { if (!a.campaign_id) continue; const t = tally(a.campaign_id); t.site += 1; if (!t.last || a.day > t.last) t.last = a.day; }
    const listTotals = new Map<string, { files: number; rows: number; worked: number }>();
    for (const l of lists) { if (!l.campaign_id) continue; const t = listTotals.get(l.campaign_id) ?? { files: 0, rows: 0, worked: 0 }; t.files += 1; t.rows += l.row_count; t.worked += listDone.get(l.id) ?? 0; listTotals.set(l.campaign_id, t); }

    // The stat cards follow the campaign filter.
    const scopedStats = chosen ? inRange.filter((s) => s.campaign_id === chosen.id) : inRange;
    const scopedSet = chosen ? setInRange.filter((a) => a.campaign_id === chosen.id) : setInRange;
    const calls = scopedStats.reduce((a, s) => a + s.calls_made, 0);
    const connected = scopedStats.reduce((a, s) => a + (s.calls_connected ?? 0), 0);
    const appts = scopedStats.reduce((a, s) => a + s.appointments_set, 0) + scopedSet.length;
    const week = new Date(Date.now() - 6 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const recent = (chosen ? stats.filter((s) => s.campaign_id === chosen.id) : stats).filter((s) => s.stat_date >= week);
    const recentAppts = recent.reduce((a, s) => a + s.appointments_set, 0) + (chosen ? setOn.filter((a) => a.campaign_id === chosen.id) : setOn).filter((a) => a.day >= week).length;
    const rows = campaigns.map((c) => ({ c, t: per.get(c.id) ?? { calls: 0, connected: 0, entered: 0, site: 0, last: null }, l: listTotals.get(c.id) ?? { files: 0, rows: 0, worked: 0 } }))
      .sort((x, y) => (y.t.entered + y.t.site) - (x.t.entered + x.t.site) || y.t.calls - x.t.calls);
    const unlinked = setInRange.filter((a) => !a.campaign_id).length;
    const top = Math.max(1, ...rows.map((r) => r.t.calls));

    // Day by day for the chosen campaign.
    const days = new Map<string, { calls: number; connected: number; entered: number; site: number }>();
    if (chosen) {
      for (const s of scopedStats) { const t = days.get(s.stat_date) ?? { calls: 0, connected: 0, entered: 0, site: 0 }; t.calls += s.calls_made; t.connected += s.calls_connected ?? 0; t.entered += s.appointments_set; days.set(s.stat_date, t); }
      for (const a of scopedSet) { const t = days.get(a.day) ?? { calls: 0, connected: 0, entered: 0, site: 0 }; t.site += 1; days.set(a.day, t); }
    }
    body = (
      <>
        <form className="cc-filters">
          <input type="hidden" name="d" value={store.id} />
          <input type="hidden" name="tab" value="analytics" />
          <label>Campaign <select className="x-input" name="campaign" defaultValue={chosen?.id ?? ""}><option value="">All campaigns</option>{categories.map((k) => <optgroup key={k} label={k}>{campaigns.filter((c) => c.category === k).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}</select></label>
          <label>From <input className="x-input" type="date" name="from" defaultValue={from} /></label>
          <label>To <input className="x-input" type="date" name="to" defaultValue={to} /></label>
          <button className="x-btn">Apply</button>
          {(from || to || chosen) && <Link className="x-btn" href={href({})} style={{ display: "inline-flex", alignItems: "center" }}>Clear</Link>}
          {staff && <Link className="x-btn x-btn-primary" href={`/command?d=${store.id}&tab=breakdown`} style={{ display: "inline-flex", alignItems: "center", marginLeft: "auto" }}>Edit the numbers</Link>}
        </form>
        <div className="cc-stats">
          <StatCard label="Outbound calls" icon={<PhoneCall size={18} aria-hidden />} value={calls} note={`${chosen ? chosen.name : "All campaigns"} · ${from || to ? "chosen dates" : "all time"}`} tone="slate" bar={100} />
          <StatCard label="Connection rate" icon={<Signal size={18} aria-hidden />} value={pct(connected, calls)} unit="%" note={calls ? `${connected.toLocaleString()} of ${calls.toLocaleString()} calls reached the customer` : "Add connected calls in Analytics Breakdown"} tone="amber" bar={pct(connected, calls)} />
          <StatCard label="Appointments" icon={<CalendarDays size={18} aria-hidden />} value={appts} note={calls ? `${pct(appts, calls)}% of calls set an appointment` : "All appointments set"} tone="green" bar={pct(appts, calls)} />
          <StatCard label="Last 7 days" icon={<Clock size={18} aria-hidden />} value={recent.reduce((a, s) => a + s.calls_made, 0)} note={`${recentAppts} appointments`} tone="blue" bar={100} />
          {chosen
            ? <StatCard label="Customers on lists" icon={<FileSpreadsheet size={18} aria-hidden />} value={(listTotals.get(chosen.id)?.rows ?? 0)} note={`${listTotals.get(chosen.id)?.files ?? 0} calling sheets · ${(listTotals.get(chosen.id)?.worked ?? 0).toLocaleString()} worked`} tone="violet" bar={pct(listTotals.get(chosen.id)?.worked ?? 0, listTotals.get(chosen.id)?.rows ?? 0)} />
            : <StatCard label="Campaigns finished" icon={<ShieldCheck size={18} aria-hidden />} value={both} of={total} note={`${pct(both, total)}% have both waves done`} tone="violet" bar={pct(both, total)} />}
        </div>
        {chosen ? (
          <Card title={`${chosen.name} by day`} note={chosen.category}>
            <Table
              head={["Date", "Calls", "Connected", "Connection rate", "Appointments entered", "Set on the site", "Total appointments", "Conversion"]}
              empty="No activity on this campaign in these dates."
              rows={[...days.entries()].sort((x, y) => y[0].localeCompare(x[0])).map(([dd, t]) => [day(dd), t.calls, t.connected, t.calls ? `${pct(t.connected, t.calls)}%` : "—", t.entered, t.site, <strong key="t">{t.entered + t.site}</strong>, t.calls ? `${pct(t.entered + t.site, t.calls)}%` : "—"])}
            />
          </Card>
        ) : (
          <Card title="By campaign" note={`Calls come from the Analytics Breakdown. Appointments are those entered there plus those set from the campaign on the site.${unlinked ? ` ${unlinked} appointments set on the site weren't tied to a campaign.` : ""}`}>
            {!campaigns.length ? <p className="text-sm text-ink-muted">No campaigns yet.</p> : (
              <div className="cc-table-scroll">
                <table className="cc-ctable">
                  <thead><tr><th>Campaign</th><th className="num">Calls</th><th className="num">Connected</th><th className="num">Conn. rate</th><th className="num">Entered</th><th className="num">On site</th><th className="num">Total</th><th>Conversion</th><th className="num">Worked / customers</th><th>Last activity</th><th>Waves</th></tr></thead>
                  <tbody>
                    {rows.map(({ c, t, l }) => {
                      const tot = t.entered + t.site;
                      return (
                        <tr key={c.id}>
                          <td><Link className="text-accent" href={href({ campaign: c.id, ...(from ? { from } : {}), ...(to ? { to } : {}) })}><strong>{c.name}</strong></Link><small>{c.category}</small></td>
                          <td className="num">{t.calls.toLocaleString()}</td>
                          <td className="num">{t.connected.toLocaleString()}</td>
                          <td className="num">{t.calls ? `${pct(t.connected, t.calls)}%` : "—"}</td>
                          <td className="num">{t.entered}</td>
                          <td className="num">{t.site}</td>
                          <td className="num"><strong>{tot}</strong></td>
                          <td><span className="cc-conv"><i style={{ width: `${(t.calls / top) * 100}%` }}><b style={{ width: `${t.calls ? Math.min(100, (tot / t.calls) * 100) : 0}%` }} /></i>{t.calls ? `${pct(tot, t.calls)}%` : "—"}</span></td>
                          <td className="num">{l.rows ? `${l.worked.toLocaleString()} / ${l.rows.toLocaleString()}` : "—"}</td>
                          <td>{t.last ? day(t.last) : "—"}</td>
                          <td><span className="cc-pill" data-on={c.wave1_done}>W1</span> <span className="cc-pill" data-on={c.wave2_done} data-wave="2">W2</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr><td>All campaigns</td><td className="num">{rows.reduce((a, r) => a + r.t.calls, 0).toLocaleString()}</td><td className="num">{rows.reduce((a, r) => a + r.t.connected, 0).toLocaleString()}</td><td className="num">{pct(rows.reduce((a, r) => a + r.t.connected, 0), rows.reduce((a, r) => a + r.t.calls, 0))}%</td><td className="num">{rows.reduce((a, r) => a + r.t.entered, 0)}</td><td className="num">{rows.reduce((a, r) => a + r.t.site, 0)}</td><td className="num"><strong>{rows.reduce((a, r) => a + r.t.entered + r.t.site, 0)}</strong></td><td /><td /><td /><td /></tr></tfoot>
                </table>
              </div>
            )}
            <p className="cc-legend">Click a campaign to see it day by day. The bar shows calls compared with the busiest campaign; the dark part is the share that became appointments.</p>
          </Card>
        )}
      </>
    );
  }

  if (tab === "breakdown") {
    const statFields = (s?: Stat) => (
      <>
        <div className="cc-form-grid">
          <Field label="Campaign"><select className="x-input" name="campaign_id" required defaultValue={s?.campaign_id ?? ""}>{[<option key="" value="" disabled>Choose a campaign</option>, ...categories.map((k) => <optgroup key={k} label={k}>{campaigns.filter((c) => c.category === k).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)]}</select></Field>
          <Field label="Date"><input className="x-input" type="date" name="stat_date" required defaultValue={s?.stat_date ?? today()} /></Field>
          <Field label="Calls made"><input className="x-input" type="number" name="calls_made" min={0} step={1} required defaultValue={s?.calls_made ?? 0} /></Field>
          <Field label="Connected calls (reached the customer)"><input className="x-input" type="number" name="calls_connected" min={0} step={1} required defaultValue={s?.calls_connected ?? 0} /></Field>
          <Field label="Appointments set"><input className="x-input" type="number" name="appointments_set" min={0} step={1} required defaultValue={s?.appointments_set ?? 0} /></Field>
        </div>
        <Field label="Notes (optional)"><input className="x-input" name="notes" defaultValue={s?.notes ?? ""} /></Field>
      </>
    );
    body = (
      <>
        {staff && (
          <Card title="Add an entry" note="How many calls the service team made on a campaign, how many reached the customer, and how many appointments they set. Managers and admins can edit or delete any entry below.">
            {!campaigns.length ? <p className="text-sm text-ink-muted">Add a campaign first.</p> : (
              <InlineForm action={addStat.bind(null, store.id)} submit="Add entry">
                {statFields()}
              </InlineForm>
            )}
          </Card>
        )}
        <Card title="Entries" note={`${stats.length} entries`}>
          <Table
            head={staff ? ["Date", "Campaign", "Calls made", "Connected", "Conn. rate", "Appointments set", "Notes", "Entered by", ""] : ["Date", "Campaign", "Calls made", "Connected", "Conn. rate", "Appointments set", "Notes"]}
            empty="No entries yet."
            rows={stats.map((s) => [
              day(s.stat_date), names.get(s.campaign_id) ?? "—", s.calls_made, s.calls_connected ?? 0, s.calls_made ? `${pct(s.calls_connected ?? 0, s.calls_made)}%` : "—", s.appointments_set, s.notes ?? "—",
              ...(staff ? [s.entered_by, <span key="x" className="x-filters"><ModalForm button="Edit" title="Edit entry" action={updateStat.bind(null, store.id, s.id)}>{statFields(s)}</ModalForm><ActionButton label="Delete" confirm="Delete this entry?" action={deleteStat.bind(null, store.id, s.id)} /></span>] : []),
            ])}
          />
        </Card>
      </>
    );
  }

  if (tab === "calls") {
    // Calls on this store's JustCall lines, with recordings to play. Default: the last 7 days.
    const todayLocal = localParts(new Date(), tz).date;
    const weekAgo = localParts(new Date(Date.now() - 6 * 86400000), tz).date;
    const fromDay = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : weekAgo;
    const toDay = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : todayLocal;
    const start = localToUtc(fromDay, "00:00", tz);
    const end = new Date(localToUtc(toDay, "23:59", tz).getTime() + 59_000);
    const direction = dir === "out" ? "Outgoing" : dir === "in" ? "Incoming" : undefined;
    const { calls: all, lines, error, capped } = await storeCalls(store.id, start, end, { direction });
    const agentsOn = [...new Set(all.map((c) => c.agent).filter(Boolean) as string[])].sort();
    const shown = all.filter((c) => (!agentPick || c.agent === agentPick) && (result === "connected" ? c.connected : result === "missed" ? !c.connected : result === "recorded" ? c.hasRecording : true));
    const connectedN = shown.filter((c) => c.connected).length;
    const talk = shown.filter((c) => c.connected).reduce((a, c) => a + c.talk, 0);
    const outN = shown.filter((c) => /out/i.test(c.direction)).length;
    const PER = 50;
    const pages = Math.max(1, Math.ceil(shown.length / PER));
    const current = Math.min(pages, Math.max(1, Number(pageParam) || 1));
    const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    const keep = { from: fromDay, to: toDay, ...(dir ? { dir } : {}), ...(agentPick ? { agent: agentPick } : {}), ...(result ? { result } : {}) };
    body = (
      <>
        <form className="cc-filters">
          <input type="hidden" name="d" value={store.id} />
          <input type="hidden" name="tab" value="calls" />
          <label>From <input className="x-input" type="date" name="from" defaultValue={fromDay} /></label>
          <label>To <input className="x-input" type="date" name="to" defaultValue={toDay} /></label>
          <label>Direction <select className="x-input" name="dir" defaultValue={dir}><option value="">All calls</option><option value="out">Outbound</option><option value="in">Inbound</option></select></label>
          <label>Agent <select className="x-input" name="agent" defaultValue={agentPick}><option value="">Everyone</option>{agentsOn.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
          <label>Result <select className="x-input" name="result" defaultValue={result}><option value="">All</option><option value="connected">Connected</option><option value="missed">Didn&apos;t connect</option><option value="recorded">Has a recording</option></select></label>
          <button className="x-btn">Apply</button>
        </form>
        {!lines.length ? (
          <Card><p className="text-sm">This store has no JustCall line saved, so there are no calls to show. {staff ? <Link className="text-accent" href={`/stores/${store.id}`}>Add the store&apos;s JustCall number</Link> : "Ask Worldwide BDC to add it."}</p></Card>
        ) : (
          <>
            {error && <p role="alert" className="text-sm" style={{ color: "#b42318" }}>{error}</p>}
            <div className="cc-stats">
              <StatCard label="Calls" icon={<PhoneCall size={18} aria-hidden />} value={shown.length} note={`${outN.toLocaleString()} outbound · ${(shown.length - outN).toLocaleString()} inbound`} tone="slate" bar={100} />
              <StatCard label="Connection rate" icon={<Signal size={18} aria-hidden />} value={pct(connectedN, shown.length)} unit="%" note={`${connectedN.toLocaleString()} reached the customer`} tone="amber" bar={pct(connectedN, shown.length)} />
              <StatCard label="Avg talk time" icon={<Clock size={18} aria-hidden />} value={connectedN ? Math.round(talk / connectedN / 60) : 0} unit=" min" note={connectedN ? `${mmss(Math.round(talk / connectedN))} per connected call` : "No connected calls"} tone="blue" bar={100} />
              <StatCard label="Recorded" icon={<Headphones size={18} aria-hidden />} value={shown.filter((c) => c.hasRecording).length} note="Calls you can listen to" tone="violet" bar={pct(shown.filter((c) => c.hasRecording).length, shown.length)} />
            </div>
            <Card title="Calls" note={`From JustCall, on ${lines.map((l) => `(${l.slice(0, 3)}) ${l.slice(3, 6)}-${l.slice(6)}`).join(", ")}. Times are store time. A call is connected when the customer was on the line.${capped ? " Showing the most recent 500 calls per line; narrow the dates to see older ones." : ""}`}>
              {!shown.length ? <p className="text-sm text-ink-muted">No calls in these dates.</p> : (
                <div className="cc-table-scroll">
                  <table className="cc-ctable cc-calls">
                    <thead><tr><th>When</th><th>Agent</th><th>Customer</th><th>Result</th><th className="num">Talk</th><th>Disposition</th><th>Recording</th></tr></thead>
                    <tbody>
                      {shown.slice((current - 1) * PER, current * PER).map((c) => (
                        <tr key={c.id}>
                          <td><span className="cc-dir" data-dir={/out/i.test(c.direction) ? "out" : "in"}>{/out/i.test(c.direction) ? <PhoneOutgoing size={14} aria-label="Outbound" /> : <PhoneIncoming size={14} aria-label="Inbound" />}</span> {showLocal(c.at, tz)}</td>
                          <td>{c.agent ?? "—"}</td>
                          <td>{c.contactName && <strong style={{ display: "block" }}>{c.contactName}</strong>}<small>{c.contact}</small></td>
                          <td><span className="cc-badge" data-tone={c.connected ? "green" : "slate"}>{c.connected ? "Connected" : c.type || "Not connected"}</span></td>
                          <td className="num">{c.connected ? mmss(c.talk) : "—"}</td>
                          <td>{c.disposition ?? "—"}{c.notes && <small style={{ display: "block" }}>{c.notes}</small>}</td>
                          <td>{c.hasRecording ? <span className="cc-rec"><audio controls preload="none" src={`/api/calls/recording?d=${store.id}&id=${c.id}`} /><a href={`/api/calls/recording?d=${store.id}&id=${c.id}&download=1`} className="text-accent">Download</a></span> : <span className="text-ink-muted">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {pages > 1 && (
                <div className="x-filters" style={{ marginTop: 10 }}>
                  {current > 1 && <Link className="x-btn" href={href({ ...keep, page: String(current - 1) })} style={{ display: "inline-flex", alignItems: "center" }}>Previous</Link>}
                  <span className="text-sm">Page {current} of {pages}</span>
                  {current < pages && <Link className="x-btn" href={href({ ...keep, page: String(current + 1) })} style={{ display: "inline-flex", alignItems: "center" }}>Next</Link>}
                </div>
              )}
            </Card>
          </>
        )}
      </>
    );
  }

  if (tab === "lists") {
    body = (
      <>
        {canUpload && <Card title="Upload an outbound list" note="A CSV file of customers to call, with a header row (for example: First name, Last name, Phone, Vehicle, Last service). Up to 20,000 rows per file.">
          <InlineForm action={uploadList.bind(null, store.id)} submit="Upload list">
            <div className="cc-form-grid">
              <Field label="CSV file"><input className="x-input" type="file" name="file" accept=".csv,text/csv" required style={{ paddingTop: 8 }} /></Field>
              <Field label="Campaign (optional)"><select className="x-input" name="campaign_id" defaultValue=""><option value="">Not tied to a campaign</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.category} · {c.name}</option>)}</select></Field>
            </div>
            <Field label="Note (optional)"><input className="x-input" name="note" placeholder="e.g. Recall list for November" /></Field>
            <TaskFields ctx={ctx} />
            <p className="text-sm text-ink-muted">{worldwide ? "The agents and teams on this store get a popup and an email when a sheet is uploaded." : "Worldwide BDC is notified as soon as you upload. Add a due date if the calls need to be done by a certain time."}</p>
          </InlineForm>
        </Card>}
        <Card title="Uploaded lists">
          <Table
            head={["File", "Campaign", "Customers", "Worked", "Due", ...(worldwide ? ["Agents"] : []), "Note", "Uploaded", ""]}
            empty="No lists uploaded yet."
            rows={lists.map((l) => {
              const ag = listAgents.get(l.id) ?? [];
              const done = listDone.get(l.id) ?? 0;
              const mineToo = ag.some((a) => a.id === user.id);
              return [
              <a key="f" className="text-accent" href={worldwide ? `/my-work/list/${l.id}` : `/command-lists/${l.id}`}>{l.file_name}</a>,
              l.campaign_id ? names.get(l.campaign_id) ?? "—" : "—",
              l.row_count.toLocaleString(),
              <span key="w" className="cc-conv"><i><b style={{ width: `${pct(done, l.row_count)}%` }} /></i>{pct(done, l.row_count)}%</span>,
              l.due_at ? <DueBadge key="d" at={l.due_at} done={done >= l.row_count} tz={tz} /> : "—",
              ...(worldwide ? [ag.length ? ag.map((a) => (a.id === user.id ? "You" : a.name)).join(", ") : "—"] : []),
              l.note ?? "—", <span key="u">{when(l.uploaded_at)}<small style={{ display: "block", color: "var(--ink-muted)" }}>{l.uploaded_by}</small></span>,
              <span key="a" className="x-filters">
                {worldwide && (staff || mineToo) && <Link className="x-btn x-btn-primary" href={`/my-work/list/${l.id}`} style={{ display: "inline-flex", alignItems: "center" }}>{done ? "Continue" : "Start"}</Link>}
                <a className="x-btn" href={`/command-lists/${l.id}`} style={{ display: "inline-flex", alignItems: "center" }}>Download</a>
                {staff && <ModalForm button="Assign" title={`Due date and agents for ${l.file_name}`} submit="Save" action={setListTask.bind(null, store.id, l.id)}><TaskFields dueAt={l.due_at} assigned={ag.map((a) => a.id)} ctx={ctx} /></ModalForm>}
                {staff && <ActionButton label="Delete" confirm={`Delete ${l.file_name}?`} action={deleteList.bind(null, store.id, l.id)} />}</span>,
              ];
            })}
          />
        </Card>
      </>
    );
  }

  return (
    <div className="x-page">
      <header className="cc-head">
        <div className="cc-logo" aria-hidden><PhoneCall size={26} /></div>
        <div className="cc-title">
          <h1>{store.name} <span className="cc-tag">Campaign Command</span></h1>
          <p>Service Retention &amp; Outbound Call Cadence Tracking Matrix</p>
          {worldwide && (
            <p className="cc-assigned">
              <Users size={14} aria-hidden /> On this store:{" "}
              {assigned.length ? assigned.map((a, i) => <span key={a.id}>{i > 0 && ", "}{a.name}</span>) : <em>nobody assigned yet</em>}
              {staff && <> · <Link className="text-accent" href={`/stores/${store.id}#assigned`}>Manage</Link></>}
            </p>
          )}
        </div>
        <div className="cc-head-actions">
          {stores.length > 1 && <StorePicker base="/command" stores={stores} selected={store.name} />}
          {worldwide && <Link className="x-btn" href={`/service/info?d=${store.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><KeyRound size={15} aria-hidden /> BDC Logins</Link>}
          {staff && <span className="cc-primary"><ModalForm button="+ New Campaign Task" title="New campaign task" submit="Add" action={saveCampaign.bind(null, store.id, null)}><CampaignFields categories={categories} ctx={ctx} /></ModalForm></span>}
          {!worldwide && <Link className="x-btn" href={`/command?${new URLSearchParams({ d: store.id, tab: "lists" })}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Upload size={15} aria-hidden /> Upload a list</Link>}
        </div>
      </header>
      <nav className="cc-tabs" role="tablist">
        {TABS.map(([k, label, Icon]) => (
          <Link key={k} role="tab" aria-selected={tab === k} data-active={tab === k} href={`/command?${new URLSearchParams({ d: store.id, tab: k })}`}>
            <Icon size={17} aria-hidden /> {label}{k === "matrix" ? ` (${categories.length})` : ""}
          </Link>
        ))}
      </nav>
      {tab === "matrix" && (
        <div className="cc-stats">
          <StatCard label="Active campaigns" icon={<Layers size={18} aria-hidden />} value={total} note={`${categories.length} ${categories.length === 1 ? "category" : "categories"}`} tone="slate" bar={total ? 100 : 0} />
          <StatCard label="Wave 1 completed" icon={<Check size={18} aria-hidden />} value={w1} of={total} note={`${pct(w1, total)}% Wave 1 calls finished`} tone="green" bar={pct(w1, total)} />
          <StatCard label="Wave 2 completed" icon={<CheckCheck size={18} aria-hidden />} value={w2} of={total} note={`${pct(w2, total)}% Wave 2 follow-ups done`} tone="blue" bar={pct(w2, total)} />
          <StatCard label="Dual-wave finished" icon={<ShieldCheck size={18} aria-hidden />} value={both} note={`${half} currently in progress`} tone="violet" bar={pct(both, total)} />
          <StatCard label="Daily run cadence" icon={<Clock size={18} aria-hidden />} value={dailyDone} of={dailies.length} note="Daily campaigns with both waves done" tone="amber" bar={pct(dailyDone, dailies.length)} />
        </div>
      )}
      <div className="x-stack">{body}</div>
      {tab === "matrix" && staff && categories.length === 0 && (
        <p className="text-sm text-ink-muted" style={{ marginTop: 12 }}><Plus size={14} aria-hidden /> Categories are created when you add a campaign with a new category name.</p>
      )}
    </div>
  );
}
