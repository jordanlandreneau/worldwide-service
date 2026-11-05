import { Field, InlineForm } from "@/components/action-form";
import { Card, Page, Table } from "@/components/ui";
import { atLeast } from "@/lib/access";
import { db, fetchAll } from "@/lib/data";
import { CATEGORIES, setRequestStatus, submitRequest } from "@/lib/requests";
import { requireScoped } from "@/lib/scope";

export const metadata = { title: "Request a change · Worldwide Service" };
const STATUS: [string, string][] = [["open", "Open"], ["in_progress", "In progress"], ["done", "Done"], ["declined", "Declined"]];
const when = (v: string) => new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

export default async function Requests({ searchParams }: { searchParams: Promise<{ d?: string; status?: string }> }) {
  const { user, stores: scope } = await requireScoped();
  const handler = atLeast(user.role, "manager");
  const { d = "", status = "" } = await searchParams;
  const stores = (await fetchAll<any>("dealerships", "id,name,active", "name")).filter((s) => s.active !== false && (scope === null || scope.includes(s.id)));
  const names = new Map(stores.map((s) => [s.id as string, s.name as string]));
  let query = db().from("change_requests").select("id,dealership_id,category,details,requested_by,requester_name,status,handled_by,emailed,created_at").order("created_at", { ascending: false }).limit(300);
  // Managers and admins see every request; everyone else sees their own.
  if (!handler) query = query.ilike("requested_by", user.email.replace(/[\\%_]/g, "\\$&"));
  if (STATUS.some(([k]) => k === status)) query = query.eq("status", status);
  const { data: rows } = await query;
  const list = (rows ?? []) as any[];
  return (
    <Page title="Request a change" subtitle="Ask the Worldwide team to change something on the site. Lauren and Leanet are emailed right away.">
      <Card title="New request">
        <InlineForm action={submitRequest} submit="Send request">
          <div className="cc-form-grid">
            <Field label="Store">
              <select className="x-input" name="dealership_id" defaultValue={stores.some((s) => s.id === d) ? d : stores.length === 1 ? stores[0].id : ""} required={user.role === "dealership"}>
                {user.role !== "dealership" && <option value="">Not about one store</option>}
                {user.role === "dealership" && stores.length > 1 && <option value="" disabled>Choose a store</option>}
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="What needs changing">
              <select className="x-input" name="category" required defaultValue="">
                <option value="" disabled>Choose one</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Details"><textarea className="x-input" name="details" required style={{ height: 140, padding: 10 }} placeholder="What should change, and what it should say now. For example: Saturday service hours are now 8:00 AM to 2:00 PM." /></Field>
        </InlineForm>
      </Card>
      <Card title={handler ? "All requests" : "Your requests"} note={`${list.length} shown`}>
        {handler && (
          <form className="x-filters" style={{ marginBottom: 14 }}>
            <select className="x-input" name="status" defaultValue={status} aria-label="Status"><option value="">All statuses</option>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <button className="x-btn x-btn-primary">Apply</button>
          </form>
        )}
        <Table
          head={["Sent", "Store", "What", "Details", ...(handler ? ["From"] : []), "Status"]}
          empty="No requests yet."
          rows={list.map((r) => [
            when(r.created_at),
            r.dealership_id ? names.get(r.dealership_id) ?? "—" : "—",
            r.category,
            <span key="d" className="x-prewrap">{r.details}</span>,
            ...(handler ? [<span key="f">{r.requester_name ?? r.requested_by}<br /><small className="text-ink-muted">{r.requested_by}{r.emailed ? "" : " · email not sent"}</small></span>] : []),
            handler ? (
              <form key="s" action={setRequestStatus.bind(null, r.id)} className="x-filters" style={{ flexWrap: "nowrap" }}>
                <select className="x-input" name="status" defaultValue={r.status} aria-label="Status" style={{ height: 32 }}>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <button className="x-btn" style={{ height: 32 }}>Save</button>
              </form>
            ) : STATUS.find(([k]) => k === r.status)?.[1] ?? r.status,
          ])}
        />
      </Card>
    </Page>
  );
}
