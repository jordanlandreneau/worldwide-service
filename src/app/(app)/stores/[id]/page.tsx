import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, Field, InlineForm, ModalForm } from "@/components/action-form";
import { DATA_TABS, ServiceDataEditor } from "@/components/service-data-editor";
import { StoreFields } from "@/components/store-form";
import { Card, Page, Table } from "@/components/ui";
import { isServiceTeam, requireUser } from "@/lib/access";
import { addAssignment, removeAssignment } from "@/lib/assign-actions";
import { assignmentsFor, serviceAgents } from "@/lib/assignments";
import { showLocal } from "@/lib/scope";
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
  const tz = (store as any).timezone || "America/New_York";
  const [assigned, agents, { data: teamRows }] = await Promise.all([assignmentsFor(id), serviceAgents(), client.from("teams").select("id,name").order("name")]);
  const serviceTeams = ((teamRows ?? []) as any[]).filter((t) => isServiceTeam(t.name));
  const taken = new Set(assigned.map((a) => `${a.kind}:${a.refId}`));
  const { data: links } = await client.from("user_dealerships").select("user_id").eq("dealership_id", id);
  const userIds = ((links ?? []) as any[]).map((l) => l.user_id as string);
  const { data: storeUsers } = userIds.length ? await client.from("app_users").select("id,first_name,last_name,email,status,last_sign_in_at").in("id", userIds).order("first_name") : { data: [] as any[] };
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
      <Card title="Assigned agents & teams" note="Who works this store. They get a popup and an email when the store uploads a calling sheet, and see the store's deadlines. A deadline here is in the store's time.">
        <div id="assigned" />
        {assigned.length ? (
          <ul className="sa-list">
            {assigned.map((a) => (
              <li key={a.id}>
                <span className="sa-kind">{a.kind === "team" ? "Team" : "Agent"}</span>
                <strong>{a.name}</strong>
                {a.dueAt && <span className="cc-badge" data-tone={new Date(a.dueAt).getTime() < Date.now() ? "red" : "slate"}>Due {showLocal(a.dueAt, tz)}</span>}
                {a.note && <span className="sa-note">{a.note}</span>}
                <ActionButton label="Remove" confirm={`Take ${a.name} off this store?`} action={removeAssignment.bind(null, id, a.id)} />
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-muted" style={{ marginBottom: 12 }}>Nobody is assigned yet. Until someone is, upload alerts go to the BDC leads.</p>}
        <InlineForm action={addAssignment.bind(null, id)} submit="Assign">
          <div className="cc-form-grid">
            <Field label="Agent or team">
              <select className="x-input" name="who" required defaultValue="">
                <option value="" disabled>Choose…</option>
                <optgroup label="Agents">{agents.filter((a) => !taken.has(`user:${a.id}`)).map((a) => <option key={a.id} value={`user:${a.id}`}>{a.name}{a.team ? ` · ${a.team}` : ""}</option>)}</optgroup>
                <optgroup label="Whole team">{serviceTeams.filter((t) => !taken.has(`team:${t.id}`)).map((t) => <option key={t.id} value={`team:${t.id}`}>{t.name}</option>)}</optgroup>
              </select>
            </Field>
            <Field label="Deadline date (optional)"><input className="x-input" type="date" name="due_date" /></Field>
            <Field label="Deadline time (store time)"><input className="x-input" type="time" name="due_time" defaultValue="17:00" /></Field>
          </div>
          <Field label="What they need to do (optional)"><input className="x-input" name="note" maxLength={500} placeholder="e.g. Finish the November recall list" /></Field>
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
      <Card title="Store logins" note="People at this store who can sign in. They see only the stores they're given.">
        <div style={{ marginBottom: 12 }}><Link className="x-btn x-btn-primary" href={`/users/new?store=${id}`} style={{ display: "inline-flex", alignItems: "center" }}>+ Create store user</Link></div>
        <Table
          head={["Name", "Email", "Status", "Last sign-in", ""]}
          empty="No store users yet."
          rows={((storeUsers ?? []) as any[]).map((u) => [
            `${u.first_name} ${u.last_name}`.trim() || "—", u.email, u.status[0].toUpperCase() + u.status.slice(1),
            u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Never",
            <Link key="e" className="x-btn" href={`/users/${u.id}/edit`} style={{ display: "inline-flex", alignItems: "center" }}>Edit access</Link>,
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
