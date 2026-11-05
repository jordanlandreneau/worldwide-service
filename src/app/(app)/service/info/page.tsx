import type { ReactNode } from "react";
import { clock, HoursGrid } from "@/components/hours-grid";
import { StorePicker } from "@/components/store-picker";
import { Card, External, Page, Table } from "@/components/ui";
import { CredentialsPanel } from "@/components/credentials-panel";
import { requireScoped } from "@/lib/scope";
import { CREDENTIAL_COLUMNS, type Credential, db } from "@/lib/data";

export const metadata = { title: "Service Data · Worldwide Service" };

const SKIP = new Set(["createdAt", "updatedAt", "dealershipId", "id"]);
const label = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const SECTIONS: [string, string[]][] = [
  ["Scheduling", ["first_appointment", "last_appointment", "same_day_appointments", "walk_ins", "drop_off_box"]],
  ["Transportation", ["loaners", "rentals", "shuttle", "valet_service"]],
  ["Service work", ["basic_services", "service_repairs", "recalls", "service_recalls", "warranty", "warranty_not_accepted", "battery_warranty", "lithia_contract", "electric_vehicles", "electric_charging"]],
  ["Diagnostics", ["diagnostics", "diagnostics_price", "diagnostics_turnaround", "diagnostics_restrictions", "diagnostics_waiver_after_repair", "saturday_diagnostics"]],
  ["Body, glass and detailing", ["bodyshop", "bodywork_collision", "paint_touch_up_wheel_repair", "glass_work", "windshield", "window_tints", "detailing", "auto_butler", "car_wash_service", "complimentary_car_wash"]],
  ["Managers and links", ["service_manager_name", "service_manager_email", "store_manager_name", "store_manager_email", "dealer_website_url", "banner_image_url"]],
];

// Turns "Yes - ZDX recalls..." into a colored answer with the detail beside it.
function Answer({ k, value }: { k: string; value: unknown }) {
  const text = String(value).trim();
  if (/_url$/.test(k)) return <External href={text} />;
  if (/_email$/.test(k)) return <a className="text-accent" href={`mailto:${text}`}>{text}</a>;
  if (/^(first|last)_appointment$/.test(k)) return <>{/^\d{2}:/.test(text) ? clock(text) : text}</>;
  const plain = text.replace(/^[^:]{3,50}:\s*(?=(yes|no)\b)/i, "");
  const m = plain.match(/^(yes|no)\b[\s.,:;-]*(.*)$/is);
  if (!m) return <span className="x-prewrap">{text}</span>;
  const yes = m[1].toLowerCase() === "yes";
  return <><span className="x-answer" data-yes={yes}>{yes ? "Yes" : "No"}</span>{m[2] && <span className="x-prewrap"> {m[2]}</span>}</>;
}
const Facts = ({ items }: { items: [string, ReactNode][] }) => <dl className="x-facts">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;

export default async function ServiceData({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  // Dealership logins only see their own stores.
  const { user, stores: scope } = await requireScoped();
  const staff = user.role !== "dealership";
  const { d } = await searchParams;
  const client = db();
  // The Service department's CRM logins (from Store Info) are shown here too, so a store's
  // Service details live in one place. Stores with a Service login but no Service Data still appear.
  const { data: dept } = await client.from("departments").select("id").ilike("name", "service").maybeSingle();
  const serviceDept = (dept?.id as string | undefined) ?? null;
  const [{ data: rows }, { data: loginStores }] = await Promise.all([
    client.from("service_profiles").select("dealership_id,data->dealership->>name"),
    staff && serviceDept ? client.from("crm_credentials").select("dealership_id,dealerships(name)").eq("department_id", serviceDept) : Promise.resolve({ data: [] as any[] }),
  ]);
  const byId = new Map<string, string>();
  for (const r of (rows ?? []) as any[]) byId.set(r.dealership_id, r.name ?? "");
  for (const r of (loginStores ?? []) as any[]) if (!byId.has(r.dealership_id)) byId.set(r.dealership_id, r.dealerships?.name ?? "");
  const stores = [...byId].filter(([sid]) => scope === null || scope.includes(sid)).map(([sid, name]) => ({ id: sid, name })).sort((a, b) => a.name.localeCompare(b.name));
  const id = d && stores.some((s) => s.id === d) ? d : stores[0]?.id;
  const [{ data: row }, { data: store }, { data: creds }, { data: rules }] = id
    ? await Promise.all([
        client.from("service_profiles").select("data").eq("dealership_id", id).maybeSingle(),
        client.from("dealerships").select("name,address,logo_url,timezone").eq("id", id).maybeSingle(),
        staff && serviceDept ? client.from("crm_credentials").select(CREDENTIAL_COLUMNS).eq("dealership_id", id).eq("department_id", serviceDept) : Promise.resolve({ data: [] as any[] }),
        staff ? client.from("store_rules").select("id,note").eq("dealership_id", id).order("created_at") : Promise.resolve({ data: [] as any[] }),
      ])
    : [{ data: null }, { data: null }, { data: [] as any[] }, { data: [] as any[] }];
  const serviceLogins = (creds ?? []) as Credential[];
  const logins = staff && serviceLogins.length > 0 && serviceDept ? (
    <Card title="Service CRM logins" note="The Service department's logins from Store Info. Acknowledge each store rule before revealing passwords.">
      <CredentialsPanel context="info" rules={(rules ?? []) as { id: string; note: string }[]} credentials={serviceLogins} deptName={{ [serviceDept]: "Service" }} />
    </Card>
  ) : null;
  const b = row?.data as any;
  const g: Record<string, unknown> = b?.generalInfo ?? {};
  const has = (k: string) => !SKIP.has(k) && g[k] !== null && g[k] !== undefined && g[k] !== "";
  const placed = new Set(SECTIONS.flatMap(([, keys]) => keys));
  const other = Object.keys(g).filter((k) => has(k) && !placed.has(k));
  const groups: [string, string[]][] = [...SECTIONS.map(([t, keys]) => [t, keys.filter(has)] as [string, string[]]), ["Other", other]];
  const notes = [...new Map([...(b?.announcements ?? []), ...(b?.limitations ?? [])].filter((n: any) => n.active !== false).map((n: any) => [String(n.text).trim().toUpperCase(), n])).values()] as any[];
  const hours = (b?.hours ?? []).map((h: any) => ({ department: h.departmentName, day: h.dayOfWeek, closed: h.closed, open: h.openTime, close: h.closeTime }));
  const logo = /^https:\/\//i.test(String(store?.logo_url ?? "")) ? (store!.logo_url as string) : null;
  return (
    <Page title="Service Data" subtitle={b?.dealership ? `${b.dealership.name} · ${b.dealership.address ?? ""}` : store ? `${store.name}${store.address ? ` · ${store.address}` : ""}` : undefined} actions={<StorePicker base="/service/info" stores={stores} selected={b?.dealership?.name ?? (store?.name as string | undefined)} />}>
      {!b ? (store ? <>{logins}<Card><p className="text-sm text-ink-muted">No Service Data has been entered for this store yet. Admins can add it in Service Admin.</p></Card></> : <p className="text-sm text-ink-muted">Select a dealership.</p>) : (
        <>
          {logo && <div className="x-logo-box">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={logo} alt={`${b.dealership?.name ?? "Store"} logo`} referrerPolicy="no-referrer" /></div>}
          {notes.length > 0 && (
            <section className="x-callout" aria-label="Announcements and limitations">
              <h2>Announcements and limitations</h2>
              <ul>{notes.map((n: any) => <li key={n.id} className="x-prewrap">{n.text}</li>)}</ul>
            </section>
          )}
          {logins}
          <Card title="Store hours" note="Times are the store's local time."><HoursGrid rows={hours} timeZone={store?.timezone as string | null} /></Card>
          <div className="x-board-grid">
            {groups.filter(([, keys]) => keys.length).map(([title, keys]) => <Card key={title} title={title}><Facts items={keys.map((k) => [label(k), <Answer key={k} k={k} value={g[k]} />])} /></Card>)}
          </div>
          <Card title="Pricing">
            <Table head={["Service", "Price", "Comments"]} rows={(b.pricing ?? []).map((p: any) => [p.service, p.price === null ? "—" : `$${p.price}`, p.comments ?? "—"])} empty="No pricing." />
          </Card>
          <Card title="Contacts">
            <Table head={["Name", "Title", "Phone", "Email", "Comments"]} rows={(b.contacts ?? []).map((c: any) => [c.name ?? "—", c.title ?? "—", c.phone ?? "—", c.email ?? "—", c.comments ?? "—"])} empty="No contacts." />
          </Card>
        </>
      )}
    </Page>
  );
}
