"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/data";
import type { Result } from "@/lib/manage";
import { DICTIONARY } from "@/lib/service-extras";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Kind = "glossary" | "dictionary";
const refresh = () => revalidatePath("/service/glossary");

// Managers and admins add to and edit the Reference Library.
export async function saveTerm(kind: Kind, id: string | null, _: Result, f: FormData): Promise<Result> {
  const user = await requireUser("manager");
  if (kind !== "glossary" && kind !== "dictionary") return { error: "Unknown list." };
  if (id && !UUID.test(id)) return { error: "This term no longer exists." };
  const term = String(f.get("term") ?? "").trim().slice(0, 200);
  const meaning = String(f.get("meaning") ?? "").trim().slice(0, 8000);
  if (!term) return { error: kind === "dictionary" ? "Enter the Spanish word." : "Enter the term." };
  if (!meaning) return { error: kind === "dictionary" ? "Enter the English meaning." : "Enter the definition." };
  const client = db();
  let same = client.from("reference_terms").select("id").eq("kind", kind).ilike("term", term.replace(/[\\%_]/g, "\\$&"));
  if (kind === "dictionary") same = same.ilike("meaning", meaning.replace(/[\\%_]/g, "\\$&"));
  if (id) same = same.neq("id", id);
  const { data: taken } = await same;
  if (taken?.length) return { error: "That term is already in the list." };
  const row = { kind, term, meaning, updated_by: user.email, updated_at: new Date().toISOString() };
  const { error } = id ? await client.from("reference_terms").update(row).eq("id", id) : await client.from("reference_terms").insert(row);
  if (error) return { error: "Couldn't save this term." };
  await client.from("edit_log").insert({ user_email: user.email, table_name: "reference_terms", row_id: id ?? term, action: id ? "update term" : "add term" });
  refresh();
  return { ok: true };
}

export async function deleteTerm(id: string) {
  const user = await requireUser("manager");
  if (!UUID.test(id)) return;
  await db().from("reference_terms").delete().eq("id", id);
  await db().from("edit_log").insert({ user_email: user.email, table_name: "reference_terms", row_id: id, action: "delete term" });
  refresh();
}

// One time: moves the glossary captured from 4.0 and the built-in dictionary into editable rows.
export async function importTerms(glossary: { term: string; meaning: string }[]): Promise<Result> {
  const user = await requireUser("admin");
  const client = db();
  const { count } = await client.from("reference_terms").select("id", { count: "exact", head: true });
  if (count) return { error: "The Reference Library has already been imported." };
  const seen = new Set<string>();
  const rows: { kind: Kind; term: string; meaning: string; updated_by: string }[] = [];
  for (const g of glossary.slice(0, 2000)) {
    const term = String(g.term ?? "").trim().slice(0, 200);
    const meaning = String(g.meaning ?? "").trim().slice(0, 8000);
    const key = `g:${term.toLowerCase()}`;
    if (term && meaning && !seen.has(key)) { seen.add(key); rows.push({ kind: "glossary", term, meaning, updated_by: user.email }); }
  }
  for (const list of Object.values(DICTIONARY)) {
    for (const pair of list.split(";")) {
      const [es, en] = pair.split("|").map((v) => v?.trim() ?? "");
      const key = `d:${es.toLowerCase()}|${en.toLowerCase()}`;
      if (es && en && !seen.has(key)) { seen.add(key); rows.push({ kind: "dictionary", term: es, meaning: en, updated_by: user.email }); }
    }
  }
  const { error } = await client.from("reference_terms").insert(rows);
  if (error) return { error: "Couldn't import the terms." };
  refresh();
  return { ok: true };
}
