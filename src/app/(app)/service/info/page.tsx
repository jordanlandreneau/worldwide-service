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
import { type Block, normalizeSection, STYLES } from "@/lib/blocks";
import { atLeast } from "@/lib/access";
import { ActionButton, Field, InlineForm, ModalForm } from "@/components/action-form";
import { StoreSectionForm } from "@/components/store-section-form";
import { deleteItem, deleteStoreSection, moveStoreSection, saveGeneral, saveItem, saveStoreSection, setSectionHidden } from "@/lib/service-admin";

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

// The bar above a section while a manager or admin is editing the page.
function EditBar({ children }: { children: ReactNode }) {
  return <div className="svc-editbar">{children}</div>;
}

export default async function ServiceData({ searchParams }: { searchParams: Promise<{ d?: string; edit?: string }> }) {
  // Dealership logins only see their own stores.
  const { user, stores: scope } = await requireScoped();
  const staff = user.role !== "dealership";
  const { d, edit: editParam } = await searchParams;
  // Managers and admins edit the page in place (like the BMW guide): ?edit=1 turns the editing tools on.
  const canEdit = atLeast(user.role, "manager");
  const edit = canEdit && editParam === "1";
  const client = db();
  const [all, { data: dept }, configured] = await Promise.all([
    fetchAll<any>("dealerships", "id,name,active", "name"),
    client.from("departments").select("id").ilike("name", "service").maybeSingle(),
    loadSections(),
  ]);
  // Sections and their questions come from Stores → Sections; the built-in list is only a fallback.
  const allSections: [string, string[], string | null][] = configured.length ? configured.map((c) => [c.title, c.fields.map((f) => f.key), c.id]) : SECTIONS.map(([t, k]) => [t, k, null]);
  const fieldLabel = new Map<string, string>(configured.flatMap((c) => c.fields.map((f) => [f.key, f.label] as const)));
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
  // In edit mode every standard section shows, answered or not, hidden ones faded with a Show button.
  const editGroups = allSections.map(([t, keys, sid]) => ({ title: t, keys, sid, hidden: !!sid && hiddenSections.has(sid) }));
  const allStoreSections = ((b.storeSections ?? []) as any[]).map(normalizeSection);
  const box = (k: string, title: string) => (
    <Field key={k} label={title}>
      <textarea className="x-input svc-edit-box" name={`g_${k}`} defaultValue={g[k] === null || g[k] === undefined ? "" : String(g[k])} rows={String(g[k] ?? "").length > 80 ? 3 : 1} />
    </Field>
  );
  const priceFields = (r?: any) => <><Field label="Service"><input className="x-input" name="service" required defaultValue={r?.service ?? ""} /></Field><Field label="Price"><input className="x-input" name="price" defaultValue={r?.price ?? ""} placeholder="e.g. 89.95" /></Field><Field label="Comments"><input className="x-input" name="comments" defaultValue={r?.comments ?? ""} /></Field></>;
  const contactFields = (r?: any) => <>{(["name", "title", "phone", "email", "comments"] as const).map((k) => <Field key={k} label={label(k)}><input className="x-input" name={k} required={k === "name"} type={k === "email" ? "email" : "text"} defaultValue={r?.[k] ?? ""} /></Field>)}</>;
  const noteFields = (r?: any) => <><Field label="Text"><textarea className="x-input" name="text" required defaultValue={r?.text ?? ""} style={{ height: 90, padding: 10 }} /></Field><Field label="Severity"><select className="x-input" name="severity" defaultValue={r?.severity ?? "warning"}><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></Field><label style={{ display: "flex", gap: 8, fontSize: 14, marginBottom: 12 }}><input type="checkbox" name="active" defaultChecked={r ? r.active !== false : true} />Show on the page</label></>;
  const allNotes = [...(b.announcements ?? []).map((n: any) => ({ ...n, list: "announcements" })), ...(b.limitations ?? []).map((n: any) => ({ ...n, list: "limitations" }))];
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
    ...(edit || notes.length || store?.special_note ? [{ id: "important", label: "Important", alert: true }] : []),
    ...(logins.length ? [{ id: "logins", label: "Logins" }] : []),
    { id: "hours", label: "Hours" },
    ...(edit ? allSections.map(([t]) => ({ id: slug(t), label: t })) : groups.map(([t]) => ({ id: slug(t), label: t }))),
    ...(edit ? ((b.storeSections ?? []) as any[]).map(normalizeSection) : storeSections).map((x) => ({ id: `own-${x.id}`, label: x.title, alert: x.style === "important" })),
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
          {canEdit && (edit
            ? <Link className="svc-edit-toggle on" href={`/service/info?d=${id}`}>Done editing</Link>
            : <Link className="svc-edit-toggle" href={`/service/info?d=${id}&edit=1`}>Edit this page</Link>)}
          {user.role === "admin" && <Link className="svc-edit-link" href={`/stores/${id}`}>Store settings, logins &amp; hours</Link>}
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
          {empty && !edit && <section className="svc-section"><div className="svc-section-body"><p className="svc-empty">No Service Data has been entered for this store yet.{canEdit ? " Use Edit this page to add it." : ""}</p></div></section>}
          {edit && <div className="svc-editing-note" role="status">You&apos;re editing this store&apos;s page. Changes save as you make them and agents see them right away. <Link href={`/service/info?d=${id}`}>Done editing</Link></div>}
          {edit && (
            <Section id="important" title="Important" alert>
              <EditBar><ModalForm button="+ Add a note" title="Add an important note" submit="Add" action={saveItem.bind(null, id, "limitations", null)}>{noteFields()}</ModalForm></EditBar>
              {allNotes.length ? (
                <ul className="svc-edit-list">{allNotes.map((n: any) => (
                  <li key={`${n.list}-${n.id}`} data-off={n.active === false}>
                    <span className="x-prewrap">{n.text}</span>
                    <span className="x-filters">
                      <ModalForm button="Edit" title="Edit note" action={saveItem.bind(null, id, n.list, n.id)}>{noteFields(n)}</ModalForm>
                      <ActionButton label="Delete" confirm="Delete this note?" action={deleteItem.bind(null, id, n.list, n.id)} />
                    </span>
                  </li>
                ))}</ul>
              ) : <p className="svc-empty">No important notes yet.</p>}
              {store?.special_note && <p className="svc-note">Special note (from store settings): {store.special_note}</p>}
            </Section>
          )}
          {!edit && (notes.length > 0 || store?.special_note) && (
            <Section id="important" title="Important" alert>
              <ul>{notes.map((n: any) => <li key={n.id} className="x-prewrap">{n.text}</li>)}{store?.special_note && <li className="x-prewrap">{store.special_note}</li>}</ul>
            </Section>
          )}
          {logins.length > 0 && <Section id="logins" title="Logins"><ServiceLogins credentials={logins} /></Section>}
          <Section id="hours" title="Hours">
            <HoursGrid rows={hours} timeZone={tz} />
            <p className="svc-note">Times are the store&apos;s local time.{edit && user.role === "admin" && <> <Link className="text-accent" href={`/stores/${id}`}>Change hours</Link></>}</p>
          </Section>
          {!edit && groups.map(([title, keys]) => (
            <Section key={title} id={slug(title)} title={title}>
              <Facts items={keys.map((k) => [fieldLabel.get(k) ?? label(k), <Answer key={k} k={k} value={g[k]} />])} />
            </Section>
          ))}
          {edit && [...editGroups, ...(other.length ? [{ title: "Other", keys: other, sid: null, hidden: false }] : [])].map((x) => (
            <section key={x.title} id={slug(x.title)} className={`svc-section${x.hidden ? " svc-hidden" : ""}`}>
              <div className="svc-section-head"><h2>{x.title}{x.hidden && <small className="svc-hidden-tag">Hidden on this store</small>}</h2></div>
              <div className="svc-section-body">
                <EditBar>
                  {x.sid && <ActionButton label={x.hidden ? "Show on this store" : "Hide on this store"} action={setSectionHidden.bind(null, id, x.sid, !x.hidden)} />}
                  {x.sid && <Link className="x-btn" href="/stores/sections" style={{ display: "inline-flex", alignItems: "center" }}>Rename or change questions (all stores)</Link>}
                </EditBar>
                {!x.hidden && (x.keys.length ? (
                  <InlineForm action={saveGeneral.bind(null, id)} submit={`Save ${x.title}`}>
                    <div className="svc-edit-grid">{x.keys.map((k) => box(k, fieldLabel.get(k) ?? label(k)))}</div>
                  </InlineForm>
                ) : <p className="svc-empty">This section has no questions yet.</p>)}
              </div>
            </section>
          ))}
          {(edit ? allStoreSections : storeSections).map((x, i, arr) => (
            <section key={x.id} id={`own-${x.id}`} className={`svc-section own-${x.style}${x.style === "important" ? " alert" : ""}`}>
              <div className="svc-section-head"><h2>{x.title}</h2></div>
              <div className="svc-section-body">
                {edit && (
                  <EditBar>
                    <span className="svc-edit-tag">Only this store · {STYLES.find((st) => st.value === x.style)?.label}</span>
                    {i > 0 && <ActionButton label="↑ Move up" action={moveStoreSection.bind(null, id, x.id, -1)} />}
                    {i < arr.length - 1 && <ActionButton label="↓ Move down" action={moveStoreSection.bind(null, id, x.id, 1)} />}
                    <ActionButton label="Delete section" confirm={`Delete "${x.title}" from this store's page?`} action={deleteStoreSection.bind(null, id, x.id)} />
                  </EditBar>
                )}
                <Blocks blocks={x.blocks} />
                {edit && <details className="svc-edit-details"><summary>Edit this section</summary><StoreSectionForm action={saveStoreSection.bind(null, id, x.id)} initial={x} /></details>}
              </div>
            </section>
          ))}
          {edit && (
            <section className="svc-section svc-add-section">
              <div className="svc-section-head"><h2>+ Add a section</h2></div>
              <div className="svc-section-body">
                <p className="svc-note" style={{ marginTop: 0 }}>A section just for this store: announcements, important notes, text with bold, highlight and underline, tables, Q&amp;A lists and link buttons.</p>
                <StoreSectionForm action={saveStoreSection.bind(null, id, null)} />
              </div>
            </section>
          )}
          <Section id="pricing" title="Pricing">
            {edit && <EditBar><ModalForm button="+ Add a price" title="Add a price" submit="Add" action={saveItem.bind(null, id, "pricing", null)}>{priceFields()}</ModalForm></EditBar>}
            <Grid kind="pricing" head={edit ? ["Service", "Price", "Comments", ""] : ["Service", "Price", "Comments"]} rows={(b.pricing ?? []).map((p: any) => [p.service, p.price === null || p.price === undefined ? "—" : `$${p.price}`, p.comments ?? "—", ...(edit ? [<span key="a" className="x-filters"><ModalForm button="Edit" title="Edit price" action={saveItem.bind(null, id, "pricing", p.id)}>{priceFields(p)}</ModalForm><ActionButton label="Delete" confirm={`Delete ${p.service}?`} action={deleteItem.bind(null, id, "pricing", p.id)} /></span>] : [])])} empty="No pricing yet." />
          </Section>
          <Section id="contacts" title="Directory">
            {edit && <EditBar><ModalForm button="+ Add a contact" title="Add a contact" submit="Add" action={saveItem.bind(null, id, "contacts", null)}>{contactFields()}</ModalForm></EditBar>}
            <Grid kind="directory" head={edit ? ["Name", "Title", "Phone", "Email", "Comments", ""] : ["Name", "Title", "Phone", "Email", "Comments"]} rows={(b.contacts ?? []).map((c: any) => [c.name ?? "—", c.title ?? "—", c.phone ?? "—", c.email ? <a key="e" href={`mailto:${c.email}`}>{c.email}</a> : "—", c.comments ?? "—", ...(edit ? [<span key="a" className="x-filters"><ModalForm button="Edit" title="Edit contact" action={saveItem.bind(null, id, "contacts", c.id)}>{contactFields(c)}</ModalForm><ActionButton label="Delete" confirm={`Delete ${c.name ?? "this contact"}?`} action={deleteItem.bind(null, id, "contacts", c.id)} /></span>] : [])])} empty="No contacts yet." />
          </Section>
        </div>
      </div>
    </div>
  );
}
