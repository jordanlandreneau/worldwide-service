import Link from "next/link";
import { MultiPick } from "@/components/multi-pick";
import { Pager, query, RangeFields, Stats } from "@/components/report-bits";
import { Card, Page, Table } from "@/components/ui";
import { requireUser } from "@/lib/access";
import { fetchAll } from "@/lib/data";
import { dateRange, dimension, lookups, many, monthWindows, production, STATUS, tally } from "@/lib/report";
import { showLocal } from "@/lib/scope";

export const metadata = { title: "Appointment Report · Worldwide Service" };
const BREAKDOWNS = ["Dealership", "Team", "Creator", "Campaign", "Status"];
type P = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// Same report as 4.0's Appointment Report, for Service appointments. Managers and admins.
export default async function AppointmentReport({ searchParams }: { searchParams: Promise<P> }) {
  await requireUser("manager");
  const p = await searchParams;
  const range = dateRange(one(p.range) || "30", one(p.from), one(p.to));
  const by = BREAKDOWNS.map((b) => b.toLowerCase()).includes(one(p.by)) ? one(p.by) : "dealership";
  const size = [25, 50, 100].includes(Number(one(p.size))) ? Number(one(p.size)) : 25;
  const f = { teams: many(p.team), stores: many(p.d), users: many(p.user), statuses: many(p.status).filter((s) => STATUS.some(([k]) => k === s)) };
  const look = await lookups();
  const [rows, users] = await Promise.all([production(range.from, range.to, f, look), fetchAll<any>("app_users", "email,first_name,last_name,role", "first_name")]);
  const w = monthWindows();
  const last = one(p.board) === "last";
  const today = await production(w.today, w.today, f, look, true);
  const month = last ? await production(w.lastFirst, w.lastEnd, f, look, true) : await production(w.first, w.today, f, look, true);
  const span = last ? `${w.lastFirst} to ${w.lastEnd}` : `${w.first} to ${w.today}`;
  const boards: [string, string, [string, number][]][] = [
    ["Agents, today", w.today, tally(today, "creator", look)],
    [`Agents, ${last ? "last month" : "month to date"}`, span, tally(month, "creator", look)],
    ["Dealerships, today", w.today, tally(today, "dealership", look)],
    [`Dealerships, ${last ? "last month" : "month to date"}`, span, tally(month, "dealership", look)],
  ];
  const breakdown = tally(rows, by, look);
  const page = Math.max(1, Number(one(p.page)) || 1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const shown = rows.slice((page - 1) * size, page * size);
  const showed = rows.filter((r) => r.status === "showed").length;
  const decided = rows.filter((r) => ["showed", "no_show"].includes(r.status)).length;
  return (
    <Page title="Appointment Report" subtitle={`Appointments set for each Service store, by date range. ${range.from} to ${range.to}`}>
      <Card>
        <form className="x-report-filters">
          <RangeFields preset={range.preset} from={range.from} to={range.to} />
          <MultiPick name="team" label="Teams" all="All teams" options={look.teams.map((t) => ({ value: t, label: t }))} selected={f.teams} />
          <MultiPick name="d" label="Dealerships" all="All dealerships" options={look.storeList.filter((s) => s.active !== false).map((s) => ({ value: s.id, label: s.name }))} selected={f.stores} />
          <MultiPick name="user" label="Set by" all="Anyone" options={users.filter((u) => u.role !== "dealership").map((u) => ({ value: u.email, label: `${u.first_name} ${u.last_name}` }))} selected={f.users} />
          <MultiPick name="status" label="Status" all="Any status" options={STATUS.map(([k, l]) => ({ value: k, label: l }))} selected={f.statuses} />
          <label className="x-field"><span>Breakdown</span><select className="x-input" name="by" defaultValue={by}>{BREAKDOWNS.map((b) => <option key={b} value={b.toLowerCase()}>{b}</option>)}</select></label>
          <label className="x-field"><span>Rows per page</span><select className="x-input" name="size" defaultValue={size}><option>25</option><option>50</option><option>100</option></select></label>
          <div className="x-filters"><button className="x-btn x-btn-primary">Apply</button><Link className="x-btn" href="/reports/appointments" style={{ display: "inline-flex", alignItems: "center" }}>Clear</Link></div>
        </form>
      </Card>
      <Card title="Leaderboard" note="Today and month windows, not the report date range. Scoped by every filter except Set by.">
        <div className="x-tabs" style={{ marginBottom: 14 }}>
          <Link className="x-tab" data-on={!last} href={`/reports/appointments?${query(p, { board: "month" })}`}>Month to date</Link>
          <Link className="x-tab" data-on={last} href={`/reports/appointments?${query(p, { board: "last" })}`}>Last month</Link>
        </div>
        <div className="x-board-grid">
          {boards.map(([title, when, list]) => (
            <div key={title}>
              <p className="x-note" style={{ marginBottom: 8 }}><strong>{title}</strong> ({when}, {list.length} ranked)</p>
              <Table head={["#", "Name", "Appointments"]} rows={list.slice(0, 10).map(([n, c], i) => [i + 1, n, c])} empty="None yet." />
            </div>
          ))}
        </div>
      </Card>
      <Stats items={[
        ["Appointments set", rows.length, `${range.days} days in range`],
        ["Daily average", (rows.length / range.days).toFixed(1), "Includes zero-production days"],
        ["Dealerships represented", new Set(rows.map((r) => r.dealership_id)).size],
        ["Show rate", decided ? `${Math.round((showed / decided) * 100)}%` : "—", `${showed} showed of ${decided} marked Showed or No show`],
      ]} />
      <Card title={`Breakdown by ${by[0].toUpperCase()}${by.slice(1)}`} note={`${breakdown.length} rows`}>
        <p style={{ marginBottom: 10 }}><a className="text-accent" href={`/reports/export?${query(p, { kind: "breakdown", by })}`}>Export to CSV</a></p>
        <Table head={["#", by[0].toUpperCase() + by.slice(1), "Appointments", "Share", "Avg / day"]} empty="No appointments in this range." rows={breakdown.map(([n, c], i) => [i + 1, n, c, `${((c / rows.length) * 100).toFixed(1)}%`, (c / range.days).toFixed(1)])} />
      </Card>
      <Card title="Appointments" note={`${rows.length} rows, newest first`}>
        <p style={{ marginBottom: 10 }}><a className="text-accent" href={`/reports/export?${query(p, { kind: "rows" })}`}>Export to CSV</a></p>
        <Table head={["Set on", "Scheduled", "Customer", "Phone", "Dealership", "Campaign", "Set by", "Status"]} empty="No appointments in this range."
          rows={shown.map((r) => {
            const tz = look.stores.get(r.dealership_id)?.timezone ?? "America/New_York";
            return [showLocal(r.created_at, tz), showLocal(r.appt_at, tz), r.customer_name, r.phone, <Link key="d" className="text-accent" href={`/appointments?d=${r.dealership_id}`}>{dimension(r, "dealership", look)}</Link>, dimension(r, "campaign", look), dimension(r, "creator", look), dimension(r, "status", look)];
          })} />
        <Pager page={page} pages={pages} href={(n) => `/reports/appointments?${query(p, { page: String(n) })}`} />
      </Card>
      <Card title="About this report"><p className="x-note">An appointment counts on the day it was set, in that dealership’s local calendar. Daily average counts every date in the range, including days with none. Show rate only counts appointments marked Showed or No show on the Appointments page.</p></Card>
    </Page>
  );
}
