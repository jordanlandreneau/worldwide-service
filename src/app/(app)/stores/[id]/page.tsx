import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, Field, InlineForm, ModalForm } from "@/components/action-form";
import { DATA_TABS, ServiceDataEditor } from "@/components/service-data-editor";
import { StoreFields } from "@/components/store-form";
import { Card, Page, Table } from "@/components/ui";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/data";
import { deleteServiceLogin, saveServiceHours, saveServiceLogin, saveStore } from "@/lib/stores";

export const metadata = { title: "Store · Worldwide Service" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export default async function StorePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ added?: string; tab?: string }> }) {
  await requireUser("admin");
  const { id } = await params;
  const { added, tab: rawTab = "store" } = await searchParams;
  const tab = DATA_TABS.some(([k]) => k === rawTab) ? rawTab : "store";
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const client = db();
  const [{ data: store }, { data: dept }] = await Promise.all([
    client.from("dealerships").select("*").eq("id", id).maybeSingle(),
    client.from("departments").select("id").ilike("name", "service").maybeSingle(),
  ]);
  if (!store) notFound();
  const [{ data: line }, { data: logins }, { data: profile }] = await Promise.all([
    dept ? client.from("dealership_departments").select("just_call_number").eq("dealership_id", id).eq("department_id", dept.id).maybeSingle() : Promise.resolve({ data: null }),
    dept ? client.from("crm_credentials").select("id,crm_type,username,login_url,has_password").eq("dealership_id", id).eq("department_id", dept.id) : Promise.resolve({ data: [] as any[] }),
    client.from("service_profiles").select("data").eq("dealership_id", id).maybeSingle(),
  ]);
  const hours = ((profile?.data as any)?.hours ?? []).filter((h: any) => h.departmentName === "Service");
  const hourFor = (d: number) => hours.find((h: any) => h.dayOfWeek === d);
  const loginFields = (l?: any) => (
    <>
      <Field label="CRM"><input className="x-input" name="crm_type" required defaultValue={l?.crm_type ?? ""} placeholder="e.g. Xtime, DealerSocket, myKaarma" /></Field>
      <Field label="Username"><input className="x-input" name="username" defaultValue={l?.username ?? ""} autoComplete="off" /></Field>
      <Field label={l ? "New password (leave blank to keep the current one)" : "Password"}><input className="x-input" name="password" type="password" autoComplete="new-password" required={!l} /></Field>
      <Field label="Login link"><input className="x-input" name="login_url" defaultValue={l?.login_url ?? ""} placeholder="https://" /></Field>
    </>
  );
  return (
    <Page title={store.name} subtitle="Everything for this store: details, JustCall numbers, Service login, hours and Service Data" actions={<span className="x-filters"><Link className="x-btn" href={`/service/info?d=${id}`} style={{ display: "inline-flex", alignItems: "center" }}>Open Service Data</Link></span>}>
      <nav className="cc-tabs" role="tablist" aria-label="Store sections">
        {([["store", "Store, logins & hours"], ...DATA_TABS] as const).map(([k, label]) => (
          <Link key={k} role="tab" aria-selected={tab === k} data-active={tab === k} href={`/stores/${id}${k === "store" ? "" : `?tab=${k}`}`}>{label}</Link>
        ))}
      </nav>
      {tab !== "store" ? <ServiceDataEditor id={id} tab={tab} /> : (
        <>
      {added && <Card><p role="status" className="text-sm">Store added. Add its Service login and hours below, then fill in its Service Data (pricing, contacts, notes) with the tabs above.</p></Card>}
      <Card title="Store">
        <InlineForm action={saveStore.bind(null, id)} submit="Save store">
          <StoreFields s={store} serviceLine={(line as any)?.just_call_number ?? null} />
        </InlineForm>
      </Card>
      <Card title="Service CRM login" note="Shown on the store's Service Data page. Passwords are encrypted.">
        <div style={{ marginBottom: 12 }}><ModalForm button="+ Add Service login" title="Add Service login" submit="Add" action={saveServiceLogin.bind(null, id, null)}>{loginFields()}</ModalForm></div>
        <Table
          head={["CRM", "Username", "Password", "Login link", ""]}
          empty="No Service login yet."
          rows={((logins ?? []) as any[]).map((l) => [
            l.crm_type ?? "—", l.username ?? "—", l.has_password ? "Saved" : "—", l.login_url ?? "—",
            <span key="a" className="x-filters">
              <ModalForm button="Edit" title={`Edit ${l.crm_type ?? "login"}`} action={saveServiceLogin.bind(null, id, l.id)}>{loginFields(l)}</ModalForm>
              <ActionButton label="Delete" confirm="Delete this login?" action={deleteServiceLogin.bind(null, id, l.id)} />
            </span>,
          ])}
        />
      </Card>
      <Card title="Service hours" note="The store's local time. Leave a day blank if you don't know it yet.">
        <InlineForm action={saveServiceHours.bind(null, id)} submit="Save hours">
          <table className="x-hours" style={{ marginBottom: 12 }}>
            <thead><tr><th scope="col">Day</th><th scope="col">Opens</th><th scope="col">Closes</th><th scope="col">Closed</th></tr></thead>
            <tbody>
              {ORDER.map((d) => {
                const h = hourFor(d);
                return (
                  <tr key={d}>
                    <th scope="row">{DAYS[d]}</th>
                    <td><input className="x-input" type="time" name={`open_${d}`} defaultValue={h?.openTime ?? ""} aria-label={`${DAYS[d]} opens`} /></td>
                    <td><input className="x-input" type="time" name={`close_${d}`} defaultValue={h?.closeTime ?? ""} aria-label={`${DAYS[d]} closes`} /></td>
                    <td><input type="checkbox" name={`closed_${d}`} defaultChecked={!!h?.closed} aria-label={`Closed ${DAYS[d]}`} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </InlineForm>
      </Card>
        </>
      )}
    </Page>
  );
}
