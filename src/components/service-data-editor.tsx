import type React from "react";
import { ActionButton, Field, InlineForm, ModalForm } from "@/components/action-form";
import { Card, Status, Table } from "@/components/ui";
import { db } from "@/lib/data";
import Link from "next/link";
import { deleteItem, saveGeneral, saveItem } from "@/lib/service-admin";
import { loadSections } from "@/lib/sections";

export const DATA_TABS = [["general", "General info"], ["pricing", "Pricing"], ["contacts", "Contacts"], ["limitations", "Limitations"], ["announcements", "Announcements"]] as const;
const SKIP = new Set(["createdAt", "updatedAt", "dealershipId", "id"]);
const GENERAL = ["ticker", "banner_image_url", "dealer_website_url", "service_specials_url", "recalls_url", "store_manager_name", "store_manager_email", "service_manager_name", "service_manager_email", "first_appointment", "last_appointment", "diagnostics", "diagnostics_price", "diagnostics_turnaround", "diagnostics_waiver_after_repair", "diagnostics_restrictions", "saturday_diagnostics", "walk_ins", "same_day_appointments", "auto_butler", "basic_services", "battery_warranty", "bodyshop", "bodywork_collision", "car_wash_service", "complimentary_car_wash", "detailing", "document_requests", "drop_off_box", "electric_charging", "electric_vehicles", "financial_assistance", "glass_work", "interval_service", "lithia_contract", "loaners", "other_dealer_maintenance_plan", "other_makes_models", "paint_touch_up_wheel_repair", "parts_installation", "payment_methods", "recalls", "rentals", "service_recalls", "service_repairs", "shuttle", "transmission_work", "valet_service", "vin_verification", "warranty", "warranty_not_accepted", "window_tints", "windshield"];
const label = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

// Edits a store's Service Data (what the Service Data page shows). Used on each store's page under Stores.
export async function ServiceDataEditor({ id, tab }: { id: string; tab: string }) {
  const { data: row } = await db().from("service_profiles").select("data").eq("dealership_id", id).maybeSingle();
  let body: React.ReactNode = null;
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
    if (tab === "general") {
      // Grouped like the Service Data page, using the sections admins manage under Stores → Sections.
      const sections = await loadSections();
      const placed = new Set(sections.flatMap((x) => x.fields.map((f) => f.key)));
      const rest = [...new Set([...GENERAL, ...Object.keys(g)])].filter((k) => !SKIP.has(k) && !placed.has(k));
      const box = (k: string, title: string, long: boolean) => long
        ? <Field label={title}><textarea className="x-input" style={{ height: 90, padding: 10 }} name={`g_${k}`} defaultValue={g[k] === null || g[k] === undefined ? "" : String(g[k])} /></Field>
        : input(`g_${k}`, title, g[k]);
      body = (
        <InlineForm action={saveGeneral.bind(null, id)} submit="Save changes" extra={<Link className="x-btn" href="/stores/sections" style={{ display: "inline-flex", alignItems: "center" }}>Edit sections and questions</Link>}>
          {sections.map((x) => (
            <Card key={x.id} title={x.title}>
              {x.fields.length === 0 ? <p className="text-sm text-ink-muted">No questions in this section yet.</p> : <div className="x-grid-2">{x.fields.map((f) => <div key={f.key}>{box(f.key, f.label, f.type === "long")}</div>)}</div>}
            </Card>
          ))}
          {rest.length > 0 && <Card title="Other"><div className="x-grid-2">{rest.map((k) => <div key={k}>{box(k, label(k), false)}</div>)}</div></Card>}
        </InlineForm>
      );
    }
    else if (tab === "pricing") body = editor("pricing", "Pricing", priceFields, ["Service", "Price", "Comments"], (r) => [r.service, r.price === null ? "—" : `$${r.price}`, r.comments ?? "—"]);
    else if (tab === "contacts") body = editor("contacts", "Contacts", contactFields, ["Name", "Title", "Phone", "Email"], (r) => [r.name ?? "—", r.title ?? "—", r.phone ?? "—", r.email ?? "—"]);
    else if (tab === "limitations") body = editor("limitations", "Limitations", (r) => noteFields(r), ["Text", "Severity", "Status"], noteCells);
    else if (tab === "announcements") body = editor("announcements", "Announcements", (r) => noteFields(r, true), ["Text", "Severity", "Status"], noteCells);
  return body;
}
