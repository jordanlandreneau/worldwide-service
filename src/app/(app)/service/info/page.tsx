import type { ReactNode } from "react";
import { clock, HoursGrid } from "@/components/hours-grid";
import Link from "next/link";
import { LiveClock } from "@/components/live-clock";
import { SectionSearch } from "@/components/section-search";
import { ServiceLogins } from "@/components/service-logins";
import { StorePicker } from "@/components/store-picker";
import { External } from "@/components/ui";
import { requireScoped } from "@/lib/scope";
import { CREDENTIAL_COLUMNS, type Credential, db, fetchAll } from "@/lib/data";
import { loadSections } from "@/lib/sections";
import { type Block, normalizeSection } from "@/lib/blocks";

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
const Facts = ({ items }: { items: [string, ReactNode][] }) => <dl className="svc-facts">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Store-only sections: blocks saved from the section editor. HTML was cleaned when it was saved.
function Blocks({ blocks }: { blocks: Block[] }) {
  return <>{blocks.map((b) => {
    if (b.type === "text") return <div key={b.id} className="svc-rich" dangerouslySetInnerHTML={{ __html: b.html }} />;
    if (b.type === "callout") return <div key={b.id} className={`svc-callout ${b.tone}`} dangerouslySetInnerHTML={{ __html: b.html }} />;
    if (b.type === "facts") return <dl key={b.id} className="svc-facts">{b.rows.map((r, i) => <div key={i}><dt>{r.label}</dt><dd className="svc-rich" dangerouslySetInnerHTML={{ __html: r.value }} /></div>)}</dl>;
    if (b.type === "table") return <Grid key={b.id} head={b.head} rows={b.rows} empty="" />;
    return <div key={b.id} className="svc-linkrow">{b.items.map((l, i) => <a key={i} className="svc-linkbtn" href={l.url} target="_blank" rel="noopener noreferrer">{l.label || l.url}</a>)}</div>;
  })}</>;
}

function Section({ id, title, alert, children }: { id: string; title: string; alert?: boolean; children: ReactNode }) {
  return (
    <section id={id} className={`svc-section${alert ? " alert" : ""}`}>
      <div className="svc-section-head"><h2>{title}</h2></div>
      <div className="svc-section-body">{children}</div>
    </section>
  );
}

function Grid({ head, rows, empty, kind }: { head: string[]; rows: ReactNode[][]; empty: string; kind?: string }) {
  if (!rows.length) return <p className="svc-empty">{empty}</p>;
  return (
    <div className="svc-table-wrap">
      <table className={`svc-table${kind ? ` svc-table-${kind}` : ""}`}>
        <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default async function ServiceData({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  // Dealership logins only see their own stores.
  const { user, stores: scope } = await requireScoped();
  const staff = user.role !== "dealership";
  const { d } = await searchParams;
  const client = db();
  const [all, { data: dept }, configured] = await Promise.all([
    fetchAll<any>("dealerships", "id,name,active", "name"),
    client.from("departments").select("id").ilike("name", "service").maybeSingle(),
    loadSections(),
  ]);
  // Sections and their questions come from Stores → Sections; the built-in list is only a fallback.
  const allSections: [string, string[], string | null][] = configured.length ? configured.map((c) => [c.title, c.fields.map((f) => f.key), c.id]) : SECTIONS.map(([t, k]) => [t, k, null]);
  const fieldLabel = new Map(configured.flatMap((c) => c.fields.map((f) => [f.key, f.label] as const)));
  const serviceDept = (dept?.id as string | undefined) ?? null;
  const stores = all.filter((s: any) => s.active !== false && (scope === null || scope.includes(s.id))).map((s: any) => ({ id: s.id as string, name: s.name as string }));
  const id = d && stores.some((s) => s.id === d) ? d : stores[0]?.id;
  if (!id) return <div className="x-page"><p className="text-sm text-ink-muted">No stores are assigned to your login yet.</p></div>;

  const [{ data: row }, { data: store }, { data: creds }] = await Promise.all([
    client.from("service_profiles").select("data").eq("dealership_id", id).maybeSingle(),
    client.from("dealerships").select("name,address,phone,website,logo_url,timezone,special_note,agent_code_number").eq("id", id).maybeSingle(),
    // The Service department's CRM logins live here, so a store's Service details are in one place.
    staff && serviceDept ? client.from("crm_credentials").select(CREDENTIAL_COLUMNS).eq("dealership_id", id).eq("department_id", serviceDept) : Promise.resolve({ data: [] as any[] }),
  ]);
  const b = (row?.data ?? {}) as any;
  const g: Record<string, unknown> = b.generalInfo ?? {};
  const has = (k: string) => !SKIP.has(k) && g[k] !== null && g[k] !== undefined && g[k] !== "";
  // A store can hide standard sections and add sections only it has (Stores → the store → General info).
  const hiddenSections = new Set<string>(b.hiddenSections ?? []);
  const sectionList: [string, string[]][] = allSections.filter(([, , sid]) => !sid || !hiddenSections.has(sid)).map(([t, k]) => [t, k]);
  const storeSections = ((b.storeSections ?? []) as any[]).map(normalizeSection).filter((x) => x.blocks.length);
  const placed = new Set(allSections.flatMap(([, keys]) => keys));
  const other = Object.keys(g).filter((k) => has(k) && !placed.has(k));
  const groups: [string, string[]][] = [...sectionList.map(([t, keys]) => [t, keys.filter(has)] as [string, string[]]), ["Other", other]].filter(([, keys]) => keys.length) as [string, string[]][];
  const notes = [...new Map([...(b.announcements ?? []), ...(b.limitations ?? [])].filter((n: any) => n.active !== false).map((n: any) => [String(n.text).trim().toUpperCase(), n])).values()] as any[];
  const hours = (b.hours ?? []).map((h: any) => ({ department: h.departmentName, day: h.dayOfWeek, closed: h.closed, open: h.openTime, close: h.closeTime }));
  const logins = (creds ?? []) as Credential[];
  const name = (store?.name as string | undefined) ?? b.dealership?.name ?? "Service Data";
  const address = (store?.address as string | undefined) ?? b.dealership?.address ?? null;
  const tz = (store?.timezone as string | undefined) ?? b.dealership?.timezone ?? null;
  const logo = /^https:\/\//i.test(String(store?.logo_url ?? "")) ? (store!.logo_url as string) : null;
  const empty = !groups.length && !notes.length && !hours.length && !(b.pricing ?? []).length && !(b.contacts ?? []).length;

  const nav: { id: string; label: string; alert?: boolean }[] = [
    ...(address ? [{ id: "map", label: "Map" }] : []),
    ...(notes.length || store?.special_note ? [{ id: "important", label: "Important", alert: true }] : []),
    ...(logins.length ? [{ id: "logins", label: "Logins" }] : []),
    { id: "hours", label: "Hours" },
    ...groups.map(([t]) => ({ id: slug(t), label: t })),
    ...storeSections.map((x) => ({ id: `own-${x.id}`, label: x.title, alert: x.style === "important" })),
    { id: "pricing", label: "Pricing" },
    { id: "contacts", label: "Directory" },
  ];

  return (
    <div className="svc">
      <section className="svc-hero">
        <div className="svc-hero-inner">
          <div className="svc-hero-text">
            {logo && /* eslint-disable-next-line @next/next/no-img-element */ <img className="svc-hero-logo" src={logo} alt="" referrerPolicy="no-referrer" />}
            <p className="svc-eyebrow">Service &amp; Scheduling Guide</p>
            <h1 className="svc-hero-title">{name}</h1>
            {address && <p className="svc-hero-sub">{address}{store?.phone ? ` · ${store.phone}` : ""}</p>}
          </div>
          <LiveClock timeZone={tz} />
        </div>
        <div className="svc-hero-bar">
          <nav className="svc-tabs" aria-label="Pages">
            <Link href={`/service/info?d=${id}`} className="active" aria-current="page">Main</Link>
            <Link href={`/command?d=${id}&tab=analytics`}>Analytics</Link>
            {staff && <Link href={`/command?d=${id}`}>Command Center</Link>}
          </nav>
          {stores.length > 1 && <div className="svc-picker"><StorePicker base="/service/info" stores={stores} selected={name} /></div>}
        </div>
      </section>

      <div className="svc-layout">
        <aside className="svc-sidebar">
          <SectionSearch />
          <nav className="svc-nav" aria-label="Sections">
            {nav.map((n) => <a key={n.id} href={`#${n.id}`} className={n.alert ? "alert" : undefined}>{n.label}</a>)}
          </nav>
          {user.role === "admin" && <Link className="svc-edit-link" href={`/stores/${id}?tab=general`}>Edit this store</Link>}
        </aside>

        <div className="svc-content">
          {address && (
            <section id="map" className="svc-map" aria-label={`Map of ${name}`}>
              <iframe title={`Map of ${name}`} src={`https://maps.google.com/maps?q=${encodeURIComponent(`${name}, ${address}`)}&z=15&output=embed`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
              <div className="svc-map-bar">
                <span>{address}</span>
                <span style={{ display: "flex", gap: 16 }}>
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${address}`)}`} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${name}, ${address}`)}`} target="_blank" rel="noopener noreferrer">Directions</a>
                </span>
              </div>
            </section>
          )}
          {empty && <section className="svc-section"><div className="svc-section-body"><p className="svc-empty">No Service Data has been entered for this store yet.{user.role === "admin" ? " Use Edit Service Data to add it." : ""}</p></div></section>}
          {(notes.length > 0 || store?.special_note) && (
            <Section id="important" title="Important" alert>
              <ul>{notes.map((n: any) => <li key={n.id} className="x-prewrap">{n.text}</li>)}{store?.special_note && <li className="x-prewrap">{store.special_note}</li>}</ul>
            </Section>
          )}
          {logins.length > 0 && <Section id="logins" title="Logins"><ServiceLogins credentials={logins} /></Section>}
          <Section id="hours" title="Hours">
            <HoursGrid rows={hours} timeZone={tz} />
            <p className="svc-note">Times are the store&apos;s local time.</p>
          </Section>
          {groups.map(([title, keys]) => (
            <Section key={title} id={slug(title)} title={title}>
              <Facts items={keys.map((k) => [fieldLabel.get(k) ?? label(k), <Answer key={k} k={k} value={g[k]} />])} />
            </Section>
          ))}
          {storeSections.map((x) => (
            <section key={x.id} id={`own-${x.id}`} className={`svc-section own-${x.style}${x.style === "important" ? " alert" : ""}`}>
              <div className="svc-section-head"><h2>{x.title}</h2></div>
              <div className="svc-section-body"><Blocks blocks={x.blocks} /></div>
            </section>
          ))}
          <Section id="pricing" title="Pricing">
            <Grid kind="pricing" head={["Service", "Price", "Comments"]} rows={(b.pricing ?? []).map((p: any) => [p.service, p.price === null || p.price === undefined ? "—" : `$${p.price}`, p.comments ?? "—"])} empty="No pricing yet." />
          </Section>
          <Section id="contacts" title="Directory">
            <Grid kind="directory" head={["Name", "Title", "Phone", "Email", "Comments"]} rows={(b.contacts ?? []).map((c: any) => [c.name ?? "—", c.title ?? "—", c.phone ?? "—", c.email ? <a key="e" href={`mailto:${c.email}`}>{c.email}</a> : "—", c.comments ?? "—"])} empty="No contacts yet." />
          </Section>
        </div>
      </div>
    </div>
  );
}
