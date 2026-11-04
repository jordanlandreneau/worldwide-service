import type { ReactNode } from "react";
import { clock, HoursGrid } from "@/components/hours-grid";
import { StorePicker } from "@/components/store-picker";
import { Card, External, Page, Table } from "@/components/ui";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/data";

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
  await requireUser();
  const { d } = await searchParams;
  const { data: rows } = await db().from("service_profiles").select("dealership_id,data->dealership->>name");
  const stores = (rows ?? []).map((r: any) => ({ id: r.dealership_id as string, name: (r.name ?? "") as string })).sort((a, b) => a.name.localeCompare(b.name));
  const id = d && stores.some((s) => s.id === d) ? d : stores[0]?.id;
  const [{ data: row }, { data: store }] = id
    ? await Promise.all([db().from("service_profiles").select("data").eq("dealership_id", id).maybeSingle(), db().from("dealerships").select("logo_url,timezone").eq("id", id).maybeSingle()])
    : [{ data: null }, { data: null }];
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
    <Page title="Service Data" subtitle={b?.dealership ? `${b.dealership.name} · ${b.dealership.address ?? ""}` : undefined} actions={<StorePicker base="/service/info" stores={stores} selected={b?.dealership?.name} />}>
      {!b ? <p className="text-sm text-ink-muted">Select a dealership.</p> : (
        <>
          {logo && <div className="x-logo-box">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={logo} alt={`${b.dealership.name} logo`} referrerPolicy="no-referrer" /></div>}
          {notes.length > 0 && (
            <section className="x-callout" aria-label="Announcements and limitations">
              <h2>Announcements and limitations</h2>
              <ul>{notes.map((n: any) => <li key={n.id} className="x-prewrap">{n.text}</li>)}</ul>
            </section>
          )}
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
