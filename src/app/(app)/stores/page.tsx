import Link from "next/link";
import { Card, Page, Status, Table } from "@/components/ui";
import { requireUser } from "@/lib/access";
import { db, fetchAll } from "@/lib/data";

export const metadata = { title: "Stores · Worldwide Service" };

export default async function Stores({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser("admin");
  const { q = "" } = await searchParams;
  const client = db();
  const { data: dept } = await client.from("departments").select("id").ilike("name", "service").maybeSingle();
  const [stores, lines, logins, profiles] = await Promise.all([
    fetchAll<any>("dealerships", "id,name,active,just_call_number,timezone", "name"),
    dept ? fetchAll<any>("dealership_departments", "dealership_id,department_id,just_call_number", "dealership_id") : Promise.resolve([]),
    dept ? fetchAll<any>("crm_credentials", "dealership_id,department_id", "dealership_id") : Promise.resolve([]),
    fetchAll<any>("service_profiles", "dealership_id", "dealership_id"),
  ]);
  const serviceLine = new Map(lines.filter((l: any) => l.department_id === dept?.id).map((l: any) => [l.dealership_id, l.just_call_number]));
  const hasLogin = new Set(logins.filter((l: any) => l.department_id === dept?.id).map((l: any) => l.dealership_id));
  const hasData = new Set(profiles.map((p: any) => p.dealership_id));
  const term = q.trim().toLowerCase();
  const shown = stores.filter((s: any) => !term || s.name.toLowerCase().includes(term));
  return (
    <Page title="Stores" subtitle={`${shown.length} shown · ${stores.length} Service stores`} actions={<Link href="/stores/new" className="x-btn x-btn-primary" style={{ display: "inline-flex", alignItems: "center" }}>+ New store</Link>}>
      <Card>
        <form className="x-filters">
          <input className="x-input" name="q" defaultValue={q} placeholder="Store name" aria-label="Search stores" />
          <button className="x-btn x-btn-primary">Search</button>
        </form>
      </Card>
      <Card>
        <Table
          head={["Store", "Status", "JustCall (store)", "JustCall (Service)", "Service login", "Service Data"]}
          rows={shown.map((s: any) => [
            <Link key="n" href={`/stores/${s.id}`} className="text-accent">{s.name}</Link>,
            <Status key="s" value={s.active !== false} />,
            s.just_call_number ?? "—", serviceLine.get(s.id) ?? "—",
            hasLogin.has(s.id) ? "Yes" : "—",
            hasData.has(s.id) ? <Link key="d" className="text-accent" href={`/service/info?d=${s.id}`}>Open</Link> : "—",
          ])}
        />
      </Card>
    </Page>
  );
}
