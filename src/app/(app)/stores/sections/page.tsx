import Link from "next/link";
import { ActionButton, Field, ModalForm } from "@/components/action-form";
import { Card, Page } from "@/components/ui";
import { requireUser } from "@/lib/access";
import { fetchAll } from "@/lib/data";
import { deleteSection, moveField, moveFieldTo, moveSection, removeField, saveField, saveSection } from "@/lib/section-admin";
import { loadSections, type Section, type SectionField } from "@/lib/sections";

export const metadata = { title: "Service Data sections · Worldwide Service" };
const SKIP = new Set(["createdAt", "updatedAt", "dealershipId", "id", "ticker"]);
const label = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function FieldForm({ f, unplaced }: { f?: SectionField; unplaced?: string[] }) {
  return (
    <>
      <Field label="Question or field name"><input className="x-input" name="label" required defaultValue={f?.label ?? ""} placeholder="e.g. Tire rotation policy" /></Field>
      <Field label="Answer box">
        <select className="x-input" name="type" defaultValue={f?.type ?? "text"}><option value="text">Short answer</option><option value="long">Long answer (several lines)</option></select>
      </Field>
      {!f && unplaced && unplaced.length > 0 && (
        <Field label="Use an answer stores already have (optional)">
          <select className="x-input" name="existing" defaultValue=""><option value="">No, start a new field</option>{unplaced.map((k) => <option key={k} value={k}>{label(k)}</option>)}</select>
        </Field>
      )}
    </>
  );
}

// Admins add, rename, reorder and remove the sections and fields on every store's Service Data page.
export default async function Sections() {
  await requireUser("manager");
  const [sections, profiles] = await Promise.all([loadSections(), fetchAll<any>("service_profiles", "data", "dealership_id")]);
  const placed = new Set(sections.flatMap((s) => s.fields.map((x) => x.key)));
  const answered = new Set<string>();
  for (const p of profiles) for (const [k, v] of Object.entries(p.data?.generalInfo ?? {})) if (!SKIP.has(k) && v !== null && v !== "") answered.add(k);
  const unplaced = [...answered].filter((k) => !placed.has(k)).sort();
  const others = (s: Section) => sections.filter((x) => x.id !== s.id);

  return (
    <Page
      title="Service Data sections"
      subtitle="The sections and questions on every store's Service Data page. Changes apply to all stores; each store's answers are filled in on its own page."
      actions={<><Link className="x-btn" href="/stores" style={{ display: "inline-flex", alignItems: "center" }}>Back to Stores</Link><ModalForm button="+ New section" title="New section" action={saveSection.bind(null, null)} submit="Add section"><Field label="Section name"><input className="x-input" name="title" required placeholder="e.g. Tires and alignment" /></Field></ModalForm></>}
    >
      {unplaced.length > 0 && (
        <Card title="Answers not in a section" note={`${unplaced.length}`}>
          <p className="text-sm" style={{ marginBottom: 8 }}>Stores have answers for these, but they aren&apos;t in a section, so they show under &quot;Other&quot;. Add them to a section with &quot;+ Add field&quot; → &quot;Use an answer stores already have&quot;.</p>
          <p className="text-sm text-ink-muted">{unplaced.map(label).join(" · ")}</p>
        </Card>
      )}
      {sections.map((s, i) => (
        <Card key={s.id} title={s.title} note={`${s.fields.length} ${s.fields.length === 1 ? "field" : "fields"}${s.standard ? " · standard" : ""}`}>
          <div className="x-filters" style={{ marginBottom: 12 }}>
            <ModalForm button="+ Add field" title={`Add a field to ${s.title}`} action={saveField.bind(null, s.id, null)} submit="Add field"><FieldForm unplaced={unplaced} /></ModalForm>
            <ModalForm button="Rename" title="Rename section" action={saveSection.bind(null, s.id)}><Field label="Section name"><input className="x-input" name="title" required defaultValue={s.title} /></Field></ModalForm>
            {i > 0 && <ActionButton label="↑ Move up" action={moveSection.bind(null, s.id, -1)} />}
            {i < sections.length - 1 && <ActionButton label="↓ Move down" action={moveSection.bind(null, s.id, 1)} />}
            <ActionButton label="Delete section" confirm={`Delete the "${s.title}" section? Stores keep their answers; those fields will show under "Other" until you add them to another section.`} action={deleteSection.bind(null, s.id)} />
          </div>
          {s.fields.length === 0 ? <p className="text-sm text-ink-muted">No fields yet. Use &quot;+ Add field&quot;.</p> : (
            <ul className="sec-fields">
              {s.fields.map((f, j) => (
                <li key={f.key}>
                  <span><strong>{f.label}</strong><small>{f.type === "long" ? "Long answer" : "Short answer"}</small></span>
                  <span className="x-filters">
                    {j > 0 && <ActionButton label="↑" action={moveField.bind(null, s.id, f.key, -1)} />}
                    {j < s.fields.length - 1 && <ActionButton label="↓" action={moveField.bind(null, s.id, f.key, 1)} />}
                    <ModalForm button="Edit" title={`Edit "${f.label}"`} action={saveField.bind(null, s.id, f.key)}><FieldForm f={f} /></ModalForm>
                    {others(s).length > 0 && (
                      <ModalForm button="Move to…" title={`Move "${f.label}" to another section`} action={moveFieldTo.bind(null, s.id, f.key)} submit="Move">
                        <Field label="Section"><select className="x-input" name="target">{others(s).map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</select></Field>
                      </ModalForm>
                    )}
                    <ActionButton label="Remove" confirm={`Remove "${f.label}" from this section? Stores keep their answers.`} action={removeField.bind(null, s.id, f.key)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </Page>
  );
}
