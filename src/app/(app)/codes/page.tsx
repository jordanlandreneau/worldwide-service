import Link from "next/link";
import { CopyCode } from "@/components/copy-code";
import { Card, Page, Table } from "@/components/ui";
import { requireUser } from "@/lib/access";
import { CodesRefresher } from "@/components/codes-refresher";
import { cachedAll, db } from "@/lib/data";
import { codeCutoff } from "@/lib/justcall";

export const metadata = { title: "Codes · Worldwide Service" };
const PER_PAGE = 50;
const when = (v: string) => new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "America/New_York" });

export default async function Codes({ searchParams }: { searchParams: Promise<{ d?: string; from?: string; to?: string; page?: string }> }) {
  await requireUser();
  const { d = "", from = "", to = "", page = "1" } = await searchParams;
  const current = Math.max(1, Number(page) || 1);
  let query = db().from("verification_codes").select("*", { count: "exact" }).gte("sms_at", codeCutoff()).order("sms_at", { ascending: false }).range((current - 1) * PER_PAGE, current * PER_PAGE - 1);
  if (/^[0-9a-f-]{36}$/i.test(d)) query = query.eq("dealership_id", d);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("sms_at", `${from}T00:00:00-05:00`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("sms_at", `${to}T23:59:59-05:00`);
  const [{ data, count }, stores] = await Promise.all([query, cachedAll("dealerships", "id,name", "name")]);
  const { data: newest } = await db().from("verification_codes").select("sms_at").gte("sms_at", codeCutoff()).order("sms_at", { ascending: false }).limit(1).maybeSingle();
  const names = new Map(stores.map((s) => [s.id as string, s.name as string]));
  const rows = (data ?? []) as any[];
  const pageLink = (n: number) => `/codes?${new URLSearchParams({ ...(d && { d }), ...(from && { from }), ...(to && { to }), page: String(n) })}`;
  return (
    <Page title="Codes" subtitle={`CRM verification codes received on dealership JustCall lines. · ${rows.length} on page · ${(count ?? 0).toLocaleString()} from the last 24 hours`} actions={<Link className="x-btn" href={pageLink(current)} style={{ display: "inline-flex", alignItems: "center" }}>Refresh</Link>}>
      {rows[0] && current === 1 && <section className="x-latest" aria-label="Latest code"><span>Latest</span><CopyCode code={rows[0].code} /><div><strong>{rows[0].dealership_id ? names.get(rows[0].dealership_id) ?? "—" : rows[0].line_name ?? "—"}</strong><small>{when(rows[0].sms_at)} from {rows[0].contact_number ?? "—"}</small><p className="x-prewrap">{rows[0].body}</p></div></section>}
      <CodesRefresher latest={(newest?.sms_at as string | undefined) ?? null} />
      <Card>
        <form className="x-filters">
          <select className="x-input" name="d" defaultValue={d} aria-label="Dealership lookup"><option value="">All dealerships</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <label className="text-sm">From <input className="x-input" type="date" name="from" defaultValue={from} /></label>
          <label className="text-sm">To <input className="x-input" type="date" name="to" defaultValue={to} /></label>
          <button className="x-btn x-btn-primary">Apply</button>
        </form>
      </Card>
      <Card>
        <Table
          head={["Code", "Dealership", "When", "From", "Message"]}
          empty="No codes yet."
          rows={rows.map((r) => [
            <CopyCode key="c" code={r.code} />,
            r.dealership_id ? names.get(r.dealership_id) ?? "—" : r.line_name ?? r.justcall_number ?? "—",
            when(r.sms_at),
            r.contact_name || r.contact_number || "—",
            <span key="m" className="x-prewrap">{r.body}</span>,
          ])}
        />
        <div className="x-filters" style={{ marginTop: 12 }}>
          {current > 1 && <Link className="x-btn" href={pageLink(current - 1)} style={{ display: "inline-flex", alignItems: "center" }}>Previous</Link>}
          {current * PER_PAGE < (count ?? 0) && <Link className="x-btn" href={pageLink(current + 1)} style={{ display: "inline-flex", alignItems: "center" }}>Next</Link>}
        </div>
      </Card>
    </Page>
  );
}
