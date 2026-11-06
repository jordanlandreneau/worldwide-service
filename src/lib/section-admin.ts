"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/data";
import type { Result } from "@/lib/manage";
import { loadSections, type Section, type SectionField } from "@/lib/sections";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (f: FormData, k: string, max = 120) => String(f.get(k) ?? "").trim().slice(0, max);
const refresh = () => { revalidatePath("/stores/sections"); revalidatePath("/service/info"); revalidatePath("/stores", "layout"); };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "field";

async function log(email: string, id: string, action: string) {
  await db().from("edit_log").insert({ user_email: email, table_name: "service_sections", row_id: id, action });
}
async function setFields(id: string, fields: SectionField[]) {
  const { error } = await db().from("service_sections").update({ fields }).eq("id", id);
  return !error;
}
async function find(id: string): Promise<Section | null> {
  if (!UUID.test(id)) return null;
  return (await loadSections()).find((s) => s.id === id) ?? null;
}

export async function saveSection(id: string | null, _: Result, f: FormData): Promise<Result> {
  const user = await requireUser("admin");
  const title = text(f, "title");
  if (!title) return { error: "Enter the section's name." };
  const client = db();
  if (id) {
    if (!UUID.test(id)) return { error: "This section no longer exists." };
    const { error } = await client.from("service_sections").update({ title }).eq("id", id);
    if (error) return { error: "Couldn't rename this section." };
    await log(user.email, id, "rename section");
  } else {
    const all = await loadSections();
    const { data, error } = await client.from("service_sections").insert({ title, sort_order: (all.at(-1)?.sort_order ?? 0) + 1, fields: [] }).select("id").single();
    if (error || !data) return { error: "Couldn't add this section." };
    await log(user.email, data.id, "add section");
  }
  refresh();
  return { ok: true };
}

export async function deleteSection(id: string) {
  const user = await requireUser("admin");
  if (!UUID.test(id)) return;
  // The stores' answers stay saved; the fields just show under "Other" until placed in another section.
  await db().from("service_sections").delete().eq("id", id);
  await log(user.email, id, "delete section");
  refresh();
}

export async function moveSection(id: string, dir: -1 | 1) {
  await requireUser("admin");
  const all = await loadSections();
  const i = all.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  await Promise.all(all.map((s, n) => db().from("service_sections").update({ sort_order: n }).eq("id", s.id)));
  refresh();
}

export async function saveField(sectionId: string, key: string | null, _: Result, f: FormData): Promise<Result> {
  const user = await requireUser("admin");
  const section = await find(sectionId);
  if (!section) return { error: "This section no longer exists." };
  const label = text(f, "label");
  const type = text(f, "type") === "long" ? "long" : "text";
  if (!label) return { error: "Enter the question or field name." };
  const all = await loadSections();
  let fields = [...section.fields];
  if (key) {
    fields = fields.map((x) => (x.key === key ? { ...x, label, type } : x));
  } else {
    // An existing store answer can be placed here by picking its key; otherwise a new key is made from the name.
    const picked = text(f, "existing", 60);
    const used = new Set(all.flatMap((s) => s.fields.map((x) => x.key)));
    let k = picked || slug(label);
    if (picked && used.has(picked)) return { error: "That field is already in a section." };
    if (!picked) { let n = 2; const base = k; while (used.has(k)) k = `${base}_${n++}`; }
    fields.push({ key: k, label, type });
  }
  if (!(await setFields(sectionId, fields))) return { error: "Couldn't save this field." };
  await log(user.email, sectionId, key ? "edit field" : "add field");
  refresh();
  return { ok: true };
}

export async function removeField(sectionId: string, key: string) {
  const user = await requireUser("admin");
  const section = await find(sectionId);
  if (!section) return;
  await setFields(sectionId, section.fields.filter((x) => x.key !== key));
  await log(user.email, sectionId, `remove field ${key}`);
  refresh();
}

export async function moveField(sectionId: string, key: string, dir: -1 | 1) {
  await requireUser("admin");
  const section = await find(sectionId);
  if (!section) return;
  const fields = [...section.fields];
  const i = fields.findIndex((x) => x.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= fields.length) return;
  [fields[i], fields[j]] = [fields[j], fields[i]];
  await setFields(sectionId, fields);
  refresh();
}

export async function moveFieldTo(sectionId: string, key: string, _: Result, f: FormData): Promise<Result> {
  const user = await requireUser("admin");
  const target = text(f, "target", 64);
  const all = await loadSections();
  const from = all.find((s) => s.id === sectionId);
  const to = all.find((s) => s.id === target);
  const field = from?.fields.find((x) => x.key === key);
  if (!from || !to || !field) return { error: "Choose a section." };
  if (from.id === to.id) return { ok: true };
  await setFields(from.id, from.fields.filter((x) => x.key !== key));
  await setFields(to.id, [...to.fields, field]);
  await log(user.email, to.id, `move field ${key}`);
  refresh();
  return { ok: true };
}
