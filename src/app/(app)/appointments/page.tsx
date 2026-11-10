import Link from "next/link";
import { ActionButton, Field, InlineForm } from "@/components/action-form";
import { PasteFill } from "@/components/paste-fill";
import { StorePicker } from "@/components/store-picker";
import { Card, Page, Table } from "@/components/ui";
import { atLeast } from "@/lib/access";
import { deleteAppointment, saveAppointment, setAppointmentStatus } from "@/lib/appointments";
import { db, fetchAll } from "@/lib/data";
import { localParts, requireScoped, showLocal } from "@/lib/scope";
import { findAppointments } from "@/lib/appointment-list";

export const metadata = { title: "Appointments · Worldwide Service" };
const STATUS: [string, string][] = [["set", "Set"], ["showed", "Showed"], ["no_show", "No show"], ["cancelled", "Cancelled"], ["rescheduled", "Rescheduled"]];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function Appointments({ searchParams }: { searchParams: Promise<{ d?: string; from?: string; to?: string; status?: string; added?: string; campaign?: string; agent?: string; dates?: string }> }) {
  const { user, stores: scope } = await requireScoped();
  const staff = user.role !== "dealership";
  const { d = "", from = "", to = "", status = "", added, campaign = "", agent = "", dates = "appt" } = await searchParams;
  const stores = (await fetchAll<any>("dealerships", "id,name,active,timezone", "name")).filter((s) => s.active !== false && (scope === null || scope.includes(s.id)));
  const store = stores.find((s) => s.id === d) ?? (stores.length === 1 ? stores[0] : undefined);
  const names = new Map(stores.map((s) => [s.id as string, s]));
  const client = db();

  const people = staff ? (await fetchAll<any>("app_users", "email,first_name,last_name,role", "first_name")).filter((u) => u.role !== "dealership") : [];
  const personName = new Map(people.map((u) => [String(u.email).toLowerCase(), `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.email]));
  const query = findAppointments({ store: store?.id, scope, agent: staff ? agent || undefined : undefined, status, from, to, dates: dates === "set" ? "set" : "appt" });
  const [appts, { data: camps }] = await Promise.all([
    query,
    store ? client.from("campaigns").select("id,category,name").eq("dealership_id", store.id).order("category").order("sort_order") : Promise.resolve({ data: [] as any[] }),
  ]);
  const campaignIds = [...new Set((appts ?? []).map((a: any) => a.campaign_id).filter(Boolean))] as string[];
  const { data: usedCamps } = campaignIds.length ? await client.from("campaigns").select("id,name").in("id", campaignIds) : { data: [] as any[] };
  const campName = new Map(((usedCamps ?? []) as any[]).map((c) => [c.id, c.name]));
  const tz = (store?.timezone as string | undefined) ?? "America/New_York";
  const today = localParts(new Date(), tz).date;

  return (
    <Page title="Appointments" subtitle={store ? `${store.name}` : staff ? "Every Service store" : "Your stores"} actions={stores.length > 1 ? <StorePicker base="/appointments" stores={stores} selected={store?.name} /> : undefined}>
      {added && <Card><p role="status" className="text-sm">Appointment saved. No text is sent; the store&apos;s CRM confirms it with the customer.</p></Card>}
      {staff && (
        <div id="set"><Card title="Set an appointment" note={store ? `Times are ${store.name}'s local time.` : "Choose the store at the top right, or paste booking notes that name the dealership."}>
          <PasteFill stores={stores.map((s) => ({ id: s.id as string, name: s.name as string }))} currentStore={store?.id ?? null} today={today} />
          {store ? (
            <InlineForm action={saveAppointment.bind(null, store.id)} submit="Save appointment">
              <div className="cc-form-grid">
                <Field label="Customer name"><input className="x-input" name="customer_name" required autoComplete="off" /></Field>
                <Field label="Phone number"><input className="x-input" name="phone" type="tel" required autoComplete="off" placeholder="(555) 555-5555" /></Field>
                <Field label="Dealership"><input className="x-input" value={store.name} readOnly aria-readonly /></Field>
              </div>
              <div className="cc-form-grid">
                <Field label="Date"><input className="x-input" type="date" name="date" required defaultValue={today} /></Field>
                <Field label="Time"><input className="x-input" type="time" name="time" required step={300} /></Field>
                <Field label="Campaign (optional)">
                  <select className="x-input" name="campaign_id" defaultValue={((camps ?? []) as any[]).some((c) => c.id === campaign) ? campaign : ""}><option value="">None</option>{((camps ?? []) as any[]).map((c) => <option key={c.id} value={c.id}>{c.category} · {c.name}</option>)}</select>
                </Field>
              </div>
              <Field label="Notes (optional)"><input className="x-input" name="notes" placeholder="Vehicle, service needed, advisor…" /></Field>
            </InlineForm>
          ) : <p className="text-sm text-ink-muted">Pick a store with the store search at the top right, then the form appears here.</p>}
        </Card></div>
      )}
      <Card title="Appointments" note={`${appts.length} shown${appts.length === 500 ? " (latest 500; narrow the filters or download the CSV for all)" : ""}`}>
        <form className="x-filters" style={{ marginBottom: 14 }}>
          {stores.length > 1 && <select className="x-input" name="d" defaultValue={store?.id ?? ""} aria-label="Dealership"><option value="">All dealerships</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
          {staff && <select className="x-input" name="agent" defaultValue={agent} aria-label="Agent"><option value="">All agents</option>{people.map((u) => <option key={u.email} value={u.email}>{personName.get(String(u.email).toLowerCase())}</option>)}</select>}
          <select className="x-input" name="dates" defaultValue={dates} aria-label="Dates apply to"><option value="appt">Appointment date</option><option value="set">Date it was set</option></select>
          <label className="text-sm">From <input className="x-input" type="date" name="from" defaultValue={from} /></label>
          <label className="text-sm">To <input className="x-input" type="date" name="to" defaultValue={to} /></label>
          <select className="x-input" name="status" defaultValue={status} aria-label="Status"><option value="">All statuses</option>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className="x-btn x-btn-primary">Apply</button>
          {(from || to || status || agent || d) && <Link className="x-btn" href="/appointments" style={{ display: "inline-flex", alignItems: "center" }}>Clear</Link>}
          <a className="x-btn" href={`/appointments/export?${new URLSearchParams({ ...(store ? { d: store.id } : {}), ...(agent ? { agent } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(status ? { status } : {}), dates })}`} style={{ display: "inline-flex", alignItems: "center", marginLeft: "auto" }}>Download CSV</a>
        </form>
        <Table
          head={["Appointment", "Set on", ...(store ? [] : ["Store"]), "Customer", "Phone", "Campaign", "Status", "Notes", ...(staff ? ["Set by", ""] : [])]}
          empty="No appointments yet."
          rows={appts.map((a) => {
            const s = names.get(a.dealership_id);
            return [
              <strong key="w">{showLocal(a.appt_at, (s?.timezone as string | undefined) ?? "America/New_York")}</strong>,
              <small key="c" className="text-ink-muted">{showLocal(a.created_at, (s?.timezone as string | undefined) ?? "America/New_York")}</small>,
              ...(store ? [] : [s?.name ?? "—"]),
              a.customer_name, a.phone, a.campaign_id ? campName.get(a.campaign_id) ?? "—" : "—",
              atLeast(user.role, "manager") ? (
                <form key="s" action={setAppointmentStatus.bind(null, a.id)} className="x-filters" style={{ flexWrap: "nowrap" }}>
                  <select className="x-input" name="status" defaultValue={a.status} aria-label="Status" style={{ height: 32 }}>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <button className="x-btn" style={{ height: 32 }}>Save</button>
                </form>
              ) : STATUS.find(([k]) => k === a.status)?.[1] ?? a.status,
              <span key="n" className="x-prewrap">{a.notes ?? "—"}</span>,
              ...(staff ? [personName.get(String(a.created_by).toLowerCase()) ?? a.created_by, atLeast(user.role, "manager") ? <ActionButton key="d" label="Delete" confirm={`Delete ${a.customer_name}'s appointment?`} action={deleteAppointment.bind(null, a.id)} /> : ""] : []),
            ];
          })}
        />
      </Card>
    </Page>
  );
}
