import Link from "next/link";
import type { ReactNode } from "react";
import { BarChart3, CalendarDays, Check, CheckCheck, ClipboardList, Clock, FileSpreadsheet, KeyRound, Layers, PhoneCall, Plus, ShieldCheck, Upload } from "lucide-react";
import { ActionButton, Field, InlineForm, ModalForm } from "@/components/action-form";
import { StorePicker } from "@/components/store-picker";
import { Card, Table } from "@/components/ui";
import { addStat, deleteCampaign, deleteList, deleteStat, saveCampaign, toggleWave, uploadList } from "@/lib/command";
import { db, fetchAll } from "@/lib/data";
import { atLeast } from "@/lib/access";
import { requireScoped } from "@/lib/scope";

export const metadata = { title: "Command Center · Worldwide Service" };

type Campaign = {
  id: string; category: string; name: string; description: string | null; cadence: string | null; list_ref: string | null;
  launch_date: string | null; wave1_done: boolean; wave2_done: boolean; script: string | null; info: string | null; sort_order: number;
};
type Stat = { id: string; campaign_id: string; stat_date: string; calls_made: number; appointments_set: number; notes: string | null; entered_by: string };
type List = { id: string; campaign_id: string | null; file_name: string; row_count: number; note: string | null; uploaded_by: string; uploaded_at: string };

const TABS = [["matrix", "Category Matrix", Layers], ["analytics", "Progress Analytics", BarChart3], ["breakdown", "Analytics Breakdown", ClipboardList], ["lists", "Outbound Lists", FileSpreadsheet]] as const;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const daily = (c: Campaign) => /daily/i.test(c.cadence ?? "");
const when = (v: string) => new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const day = (v: string) => new Date(`${v}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

function StatCard({ label, icon, value, of, note, tone, bar }: { label: string; icon: ReactNode; value: number; of?: number; note: string; tone: string; bar: number }) {
  return (
    <div className="cc-stat" data-tone={tone}>
      <div className="cc-stat-head"><span>{label}</span>{icon}</div>
      <div className="cc-stat-value"><strong>{value}</strong>{of !== undefined && <small>/ {of}</small>}</div>
      <p>{note}</p>
      <div className="cc-bar"><i style={{ width: `${Math.min(100, Math.max(0, bar))}%` }} /></div>
    </div>
  );
}

function CampaignFields({ c, category, categories }: { c?: Campaign; category?: string; categories: string[] }) {
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
    </>
  );
}

export default async function CommandCenter({ searchParams }: { searchParams: Promise<{ d?: string; tab?: string; q?: string; cat?: string; status?: string; from?: string; to?: string }> }) {
  const { user, stores: scope } = await requireScoped();
  const { d, tab: rawTab = "matrix", q = "", cat = "", status = "", from = "", to = "" } = await searchParams;
  const tab = TABS.some(([k]) => k === rawTab) ? rawTab : "matrix";
  const stores = (await fetchAll<any>("dealerships", "id,name,active", "name")).filter((s: any) => s.active !== false && (scope === null || scope.includes(s.id))) as { id: string; name: string }[];
  const store = stores.find((s) => s.id === d) ?? stores[0];
  // staff = can edit campaigns, mark waves and enter analytics (managers and admins).
  const staff = atLeast(user.role, "manager");
  const worldwide = user.role !== "dealership";
  const canUpload = !worldwide || staff;

  if (!store) {
    return <div className="x-page"><Card><p className="text-sm text-ink-muted">No stores are assigned to your login yet. Ask Worldwide BDC to add your store.</p></Card></div>;
  }

  const client = db();
  const [{ data: c1 }, { data: s1 }, { data: l1 }] = await Promise.all([
    client.from("campaigns").select("id,category,name,description,cadence,list_ref,launch_date,wave1_done,wave2_done,script,info,sort_order").eq("dealership_id", store.id).order("category").order("sort_order").order("created_at"),
    client.from("campaign_stats").select("id,campaign_id,stat_date,calls_made,appointments_set,notes,entered_by").eq("dealership_id", store.id).order("stat_date", { ascending: false }).order("created_at", { ascending: false }).limit(2000),
    client.from("outbound_lists").select("id,campaign_id,file_name,row_count,note,uploaded_by,uploaded_at").eq("dealership_id", store.id).order("uploaded_at", { ascending: false }).limit(200),
  ]);
  const campaigns = (c1 ?? []) as Campaign[];
  const stats = (s1 ?? []) as Stat[];
  const lists = (l1 ?? []) as List[];
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
        {!campaigns.length && <Card><p className="text-sm text-ink-muted">{staff ? "No campaigns yet. Use New Campaign Task to add the first one." : "No campaigns have been set up for this store yet."}</p></Card>}
        {groups.map(([k, list]) => {
          const all = campaigns.filter((c) => c.category === k);
          return (
            <section key={k} className="cc-group">
              <header>
                <span className="cc-group-name">{k}</span>
                <span className="cc-chip">{all.length} {all.length === 1 ? "task" : "tasks"}</span>
                <span className="cc-group-tally">W1: <b data-tone="green">{all.filter((c) => c.wave1_done).length}/{all.length}</b> | W2: <b data-tone="blue">{all.filter((c) => c.wave2_done).length}/{all.length}</b></span>
                {staff && <span className="cc-add"><ModalForm button="+ Add Row" title={`Add to ${k}`} submit="Add" action={saveCampaign.bind(null, store.id, null)}><CampaignFields category={k} categories={categories} /></ModalForm></span>}
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
                        {lists.filter((l) => l.campaign_id === c.id).map((l, i) => <span key={l.id}>{i > 0 && " · "}<a className="text-accent" href={`/command-lists/${l.id}`}>{l.file_name}</a> ({l.row_count.toLocaleString()})</span>)}
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
                        <ModalForm button="Upload CSV" title={`Upload a list to ${c.name}`} note="A CSV file with a header row. Up to 20,000 rows." submit="Upload" action={uploadList.bind(null, store.id)}><input type="hidden" name="campaign_id" value={c.id} /><Field label="CSV file"><input className="x-input" type="file" name="file" accept=".csv,text/csv" required style={{ paddingTop: 8 }} /></Field><Field label="Note (optional)"><input className="x-input" name="note" /></Field></ModalForm>
                        <ModalForm button="Edit" title={`Edit ${c.name}`} action={saveCampaign.bind(null, store.id, c.id)}><CampaignFields c={c} categories={categories} /></ModalForm>
                        <ActionButton label="Delete" confirm={`Delete ${c.name}? Its analytics entries are deleted too.`} action={deleteCampaign.bind(null, store.id, c.id)} />
                      </>
                    ) : (
                      <>
                        <span className="cc-wave" data-wave="1" data-on={c.wave1_done}>{c.wave1_done ? <Check size={15} aria-hidden /> : <span className="cc-dot" aria-hidden />} Wave 1</span>
                        <span className="cc-wave" data-wave="2" data-on={c.wave2_done}>{c.wave2_done ? <Check size={15} aria-hidden /> : <span className="cc-dot" aria-hidden />} Wave 2</span>
                        {worldwide && <><span className="cc-sep" aria-hidden />{worldwide && <Link className="x-btn" href={`/appointments?d=${store.id}&campaign=${c.id}#set`} style={{ display: "inline-flex", alignItems: "center" }}>Set appointment</Link>}</>}
                        {canUpload && <><span className="cc-sep" aria-hidden /><ModalForm button="Upload CSV" title={`Upload a list to ${c.name}`} note="A CSV file with a header row. Up to 20,000 rows." submit="Upload" action={uploadList.bind(null, store.id)}><input type="hidden" name="campaign_id" value={c.id} /><Field label="CSV file"><input className="x-input" type="file" name="file" accept=".csv,text/csv" required style={{ paddingTop: 8 }} /></Field><Field label="Note (optional)"><input className="x-input" name="note" /></Field></ModalForm></>}
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
    const inRange = stats.filter((s) => (!from || s.stat_date >= from) && (!to || s.stat_date <= to));
    // Appointments overall: the counts entered in the Analytics Breakdown plus the ones set on the Appointments page.
    const { data: a1 } = await client.from("appointments").select("campaign_id,created_at").eq("dealership_id", store.id).neq("status", "cancelled").limit(20000);
    const setOn = ((a1 ?? []) as { campaign_id: string | null; created_at: string }[]).map((a) => ({ campaign_id: a.campaign_id, day: new Date(a.created_at).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) }));
    const setInRange = setOn.filter((a) => (!from || a.day >= from) && (!to || a.day <= to));
    const per = new Map<string, { calls: number; appts: number }>();
    for (const s of inRange) {
      const t = per.get(s.campaign_id) ?? { calls: 0, appts: 0 };
      t.calls += s.calls_made; t.appts += s.appointments_set;
      per.set(s.campaign_id, t);
    }
    for (const a of setInRange) {
      if (!a.campaign_id) continue;
      const t = per.get(a.campaign_id) ?? { calls: 0, appts: 0 };
      t.appts += 1;
      per.set(a.campaign_id, t);
    }
    const calls = inRange.reduce((a, s) => a + s.calls_made, 0);
    const appts = inRange.reduce((a, s) => a + s.appointments_set, 0) + setInRange.length;
    const week = new Date(Date.now() - 6 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const recent = stats.filter((s) => s.stat_date >= week);
    const recentAppts = recent.reduce((a, s) => a + s.appointments_set, 0) + setOn.filter((a) => a.day >= week).length;
    const top = Math.max(1, ...[...per.values()].map((t) => t.calls));
    body = (
      <>
        <form className="cc-filters">
          <input type="hidden" name="d" value={store.id} />
          <input type="hidden" name="tab" value="analytics" />
          <label>From <input className="x-input" type="date" name="from" defaultValue={from} /></label>
          <label>To <input className="x-input" type="date" name="to" defaultValue={to} /></label>
          <button className="x-btn">Apply</button>
          {(from || to) && <Link className="x-btn" href={href({})} style={{ display: "inline-flex", alignItems: "center" }}>All time</Link>}
        </form>
        <div className="cc-stats">
          <StatCard label="Outbound calls" icon={<PhoneCall size={18} aria-hidden />} value={calls} note={from || to ? "In the chosen dates" : "All time"} tone="slate" bar={100} />
          <StatCard label="Appointments" icon={<CalendarDays size={18} aria-hidden />} value={appts} note={calls ? `${pct(appts, calls)}% of calls set an appointment` : "All appointments set"} tone="green" bar={pct(appts, calls)} />
          <StatCard label="Last 7 days" icon={<Clock size={18} aria-hidden />} value={recent.reduce((a, s) => a + s.calls_made, 0)} note={`${recentAppts} appointments`} tone="blue" bar={100} />
          <StatCard label="Campaigns finished" icon={<ShieldCheck size={18} aria-hidden />} value={both} of={total} note={`${pct(both, total)}% have both waves done`} tone="violet" bar={pct(both, total)} />
        </div>
        <Card title="By campaign" note="Calls come from the Analytics Breakdown. Appointments include those entered there and those set from the campaign.">
          {!campaigns.length ? <p className="text-sm text-ink-muted">No campaigns yet.</p> : (
            <div className="cc-bars">
              {campaigns.map((c) => {
                const t = per.get(c.id) ?? { calls: 0, appts: 0 };
                return (
                  <div key={c.id} className="cc-bars-row">
                    <div className="cc-bars-label"><strong>{c.name}</strong><small>{c.category}</small></div>
                    <div className="cc-bars-track" aria-label={`${t.calls} calls, ${t.appts} appointments`}>
                      <i className="cc-bars-calls" style={{ width: `${(t.calls / top) * 100}%` }} />
                      <i className="cc-bars-appts" style={{ width: `${(t.appts / top) * 100}%` }} />
                    </div>
                    <div className="cc-bars-nums"><span>{t.calls} calls</span><span>{t.appts} set</span><span>{pct(t.appts, t.calls)}%</span></div>
                    <div className="cc-bars-waves"><span className="cc-pill" data-on={c.wave1_done}>W1</span><span className="cc-pill" data-on={c.wave2_done} data-wave="2">W2</span></div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="cc-legend"><i className="cc-bars-calls" /> Calls made <i className="cc-bars-appts" /> Appointments set</p>
        </Card>
      </>
    );
  }

  if (tab === "breakdown") {
    body = (
      <>
        {staff && (
          <Card title="Add an entry" note="How many calls the service team made on a campaign, and how many appointments they set.">
            {!campaigns.length ? <p className="text-sm text-ink-muted">Add a campaign first.</p> : (
              <InlineForm action={addStat.bind(null, store.id)} submit="Add entry">
                <div className="cc-form-grid">
                  <Field label="Campaign"><select className="x-input" name="campaign_id" required defaultValue="">{[<option key="" value="" disabled>Choose a campaign</option>, ...categories.map((k) => <optgroup key={k} label={k}>{campaigns.filter((c) => c.category === k).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)]}</select></Field>
                  <Field label="Date"><input className="x-input" type="date" name="stat_date" required defaultValue={today()} /></Field>
                  <Field label="Calls made"><input className="x-input" type="number" name="calls_made" min={0} step={1} required defaultValue={0} /></Field>
                  <Field label="Appointments set"><input className="x-input" type="number" name="appointments_set" min={0} step={1} required defaultValue={0} /></Field>
                </div>
                <Field label="Notes (optional)"><input className="x-input" name="notes" /></Field>
              </InlineForm>
            )}
          </Card>
        )}
        <Card title="Entries" note={`${stats.length} entries`}>
          <Table
            head={staff ? ["Date", "Campaign", "Calls made", "Appointments set", "Notes", "Entered by", ""] : ["Date", "Campaign", "Calls made", "Appointments set", "Notes"]}
            empty="No entries yet."
            rows={stats.map((s) => [
              day(s.stat_date), names.get(s.campaign_id) ?? "—", s.calls_made, s.appointments_set, s.notes ?? "—",
              ...(staff ? [s.entered_by, <ActionButton key="x" label="Delete" confirm="Delete this entry?" action={deleteStat.bind(null, store.id, s.id)} />] : []),
            ])}
          />
        </Card>
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
          </InlineForm>
        </Card>}
        <Card title="Uploaded lists">
          <Table
            head={["File", "Campaign", "Customers", "Note", "Uploaded by", "When", ""]}
            empty="No lists uploaded yet."
            rows={lists.map((l) => [
              <a key="f" className="text-accent" href={`/command-lists/${l.id}`}>{l.file_name}</a>,
              l.campaign_id ? names.get(l.campaign_id) ?? "—" : "—",
              l.row_count.toLocaleString(), l.note ?? "—", l.uploaded_by, when(l.uploaded_at),
              <span key="a" className="x-filters"><a className="x-btn" href={`/command-lists/${l.id}`} style={{ display: "inline-flex", alignItems: "center" }}>Download</a>{staff && <ActionButton label="Delete" confirm={`Delete ${l.file_name}?`} action={deleteList.bind(null, store.id, l.id)} />}</span>,
            ])}
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
        </div>
        <div className="cc-head-actions">
          {stores.length > 1 && <StorePicker base="/command" stores={stores} selected={store.name} />}
          {worldwide && <Link className="x-btn" href={`/service/info?d=${store.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><KeyRound size={15} aria-hidden /> BDC Logins</Link>}
          {staff && <span className="cc-primary"><ModalForm button="+ New Campaign Task" title="New campaign task" submit="Add" action={saveCampaign.bind(null, store.id, null)}><CampaignFields categories={categories} /></ModalForm></span>}
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
