import type React from "react";
import Link from "next/link";
import { ActionButton, Field, InlineForm, ModalForm } from "@/components/action-form";
import { StorePicker } from "@/components/store-picker";
import { Card, Field as Facts, Page, Status, Table } from "@/components/ui";
import { requireUser } from "@/lib/access";
import { db, fetchAll } from "@/lib/data";
import { deleteItem, saveGeneral, saveItem } from "@/lib/service-admin";

export const metadata = { title: "Service Data Management · Worldwide Service" };

const TABS = [["overview", "Overview"], ["general", "General Information"], ["pricing", "Pricing"], ["contacts", "Contacts"], ["limitations", "Limitations"], ["announcements", "Announcements"]] as const;
const SKIP = new Set(["createdAt", "updatedAt", "dealershipId", "id"]);
const GENERAL = ["ticker", "banner_image_url", "dealer_website_url", "service_specials_url", "recalls_url", "store_manager_name", "store_manager_email", "service_manager_name", "service_manager_email", "first_appointment", "last_appointment", "diagnostics", "diagnostics_price", "diagnostics_turnaround", "diagnostics_waiver_after_repair", "diagnostics_restrictions", "saturday_diagnostics", "walk_ins", "same_day_appointments", "auto_butler", "basic_services", "battery_warranty", "bodyshop", "bodywork_collision", "car_wash_service", "complimentary_car_wash", "detailing", "document_requests", "drop_off_box", "electric_charging", "electric_vehicles", "financial_assistance", "glass_work", "interval_service", "lithia_contract", "loaners", "other_dealer_maintenance_plan", "other_makes_models", "paint_touch_up_wheel_repair", "parts_installation", "payment_methods", "recalls", "rentals", "service_recalls", "service_repairs", "shuttle", "transmission_work", "valet_service", "vin_verification", "warranty", "warranty_not_accepted", "window_tints", "windshield"];
const label = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export default async function ServiceManage({ searchParams }: { searchParams: Promise<{ d?: string; tab?: string }> }) {
  await requireUser("admin");
  const { d, tab = "overview" } = await searchParams;
  const stores = await fetchAll<{ id: string; name: string }>("dealerships", "id,name", "name");
  const store = stores.find((s) => s.id === d);
  let body = null;
  if (store) {
    const id = store.id;
    const { data: row } = await db().from("service_profiles").select("data").eq("dealership_id", id).maybeSingle();
    const p = (row?.data ?? {}) as any;
    const g = p.generalInfo ?? {};
    const input = (name: string, title: string, value?: unknown, type = "text") => <Field label={title}><input className="x-input" name={name} type={type} defaultValue={value === null || value === undefined ? "" : String(value)} /></Field>;
    const noteFields = (r?: any, dates = false) => <>
      <Field label="Text"><textarea className="x-input" style={{ height: 100, padding: 10 }} name="text" required defaultValue={r?.text ?? ""} /></Field>
      <Field label="Severity"><select className="x-input" name="severity" defaultValue={r?.severity ?? "info"}><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></Field>
      {dates && input("startsAt", "Starts", r?.startsAt)}
      {dates && input("endsAt", "Ends", r?.endsAt)}
      <label style={{ display: "flex", gap: 8, fontSize: 14, marginBottom: 12 }}><input type="checkbox" name="active" defaultChecked={r ? r.active !== false : true} />Active</label>
    </>;
    const priceFields = (r?: any) => <>{input("service", "Service", r?.service)}{input("price", "Price", r?.price)}{input("comments", "Comments", r?.comments)}</>;
    const contactFields = (r?: any) => <>{input("name", "Name", r?.name)}{input("title", "Title", r?.title)}{input("phone", "Phone", r?.phone)}{input("email", "Email", r?.email, "email")}{input("comments", "Comments", r?.comments)}</>;
    const editor = (list: string, title: string, fields: (r?: any) => React.ReactNode, head: string[], cells: (r: any) => React.ReactNode[]) => (
      <Card title={title}>
        <div style={{ marginBottom: 12 }}><ModalForm button="Add" title={`Add to ${title.toLowerCase()}`} submit="Add" action={saveItem.bind(null, id, list, null)}>{fields()}</ModalForm></div>
        <Table head={[...head, "Actions"]} rows={(p[list] ?? []).map((r: any) => [...cells(r),
          <span key="a" className="x-filters">
            <ModalForm button="Edit" title={`Edit ${title.toLowerCase()}`} action={saveItem.bind(null, id, list, r.id)}>{fields(r)}</ModalForm>
            <ActionButton label="Delete" confirm="Delete this item?" action={deleteItem.bind(null, id, list, r.id)} />
          </span>])} />
      </Card>
    );
    const noteCells = (r: any) => [<span key="t" className="x-prewrap">{r.text}</span>, r.severity ?? "—", <Status key="s" value={r.active !== false} />];
    if (tab === "general") body = (
      <Card title="General Information">
        <InlineForm action={saveGeneral.bind(null, id)} submit="Save changes">
          <div className="x-grid-2">{[...new Set([...GENERAL, ...Object.keys(g).filter((k) => !SKIP.has(k))])].map((k) => <div key={k}>{input(`g_${k}`, label(k), g[k])}</div>)}</div>
        </InlineForm>
      </Card>
    );
    else if (tab === "pricing") body = editor("pricing", "Pricing", priceFields, ["Service", "Price", "Comments"], (r) => [r.service, r.price === null ? "—" : `$${r.price}`, r.comments ?? "—"]);
    else if (tab === "contacts") body = editor("contacts", "Contacts", contactFields, ["Name", "Title", "Phone", "Email"], (r) => [r.name ?? "—", r.title ?? "—", r.phone ?? "—", r.email ?? "—"]);
    else if (tab === "limitations") body = editor("limitations", "Limitations", (r) => noteFields(r), ["Text", "Severity", "Status"], noteCells);
    else if (tab === "announcements") body = editor("announcements", "Announcements", (r) => noteFields(r, true), ["Text", "Severity", "Status"], noteCells);
    else body = (
      <Card title="Overview">
        <Facts items={[["General information fields", Object.entries(g).filter(([k, v]) => !SKIP.has(k) && v).length], ["Pricing items", (p.pricing ?? []).length], ["Contacts", (p.contacts ?? []).length], ["Limitations", (p.limitations ?? []).length], ["Announcements", (p.announcements ?? []).length]]} />
      </Card>
    );
  }
  return (
    <Page title="Service Data Management" subtitle={store?.name} actions={<StorePicker base="/service/manage" stores={stores} selected={store?.name} />}>
      {store ? (
        <>
          <div className="x-filters" role="tablist">
            {TABS.map(([key, text]) => <Link key={key} role="tab" aria-selected={tab === key} className={`x-btn ${tab === key ? "x-btn-primary" : ""}`} style={{ display: "inline-flex", alignItems: "center" }} href={`/service/manage?d=${store.id}&tab=${key}`}>{text}</Link>)}
          </div>
          {body}
        </>
      ) : <Card><p className="text-sm text-ink-muted">Select a dealership.</p></Card>}
    </Page>
  );
}
