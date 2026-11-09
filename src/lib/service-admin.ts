"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/data";
import type { Result } from "@/lib/manage";
import { cleanSection } from "@/lib/blocks";

const LISTS: Record<string, string[]> = {
  pricing: ["service", "price", "comments"],
  contacts: ["name", "title", "phone", "email", "comments"],
  limitations: ["text", "severity"],
  announcements: ["text", "severity", "startsAt", "endsAt"],
};

async function load(id: string) {
  const client = db();
  const { data: row } = await client.from("service_profiles").select("data").eq("dealership_id", id).maybeSingle();
  if (row) return row.data as Record<string, any>;
  const { data: store } = await client.from("dealerships").select("id,name,address,timezone").eq("id", id).maybeSingle();
  if (!store) return null;
  return { dealership: store, generalInfo: {}, pricing: [], contacts: [], contactImages: [], limitations: [], announcements: [], hours: [] } as Record<string, any>;
}
async function store(email: string, id: string, data: Record<string, any>, action: string): Promise<Result> {
  const client = db();
  const { error } = await client.from("service_profiles").upsert({ dealership_id: id, data });
  if (error) return { error: "Couldn't save this." };
  await client.from("edit_log").insert({ user_email: email, table_name: "service_profiles", row_id: id, action });
  revalidatePath(`/stores/${id}`);
  revalidatePath("/service/info");
  return { ok: true };
}

export async function saveGeneral(id: string, _: Result, f: FormData): Promise<Result> {
  const user = await requireUser("admin");
  const data = await load(id);
  if (!data) return { error: "This dealership no longer exists." };
  const general = { ...(data.generalInfo ?? {}) };
  for (const [k, v] of f.entries()) {
    if (!k.startsWith("g_") || typeof v !== "string") continue;
    general[k.slice(2)] = v.trim() === "" ? null : v.trim();
  }
  general.updatedAt = new Date().toISOString();
  return store(user.email, id, { ...data, generalInfo: general }, "update general");
}

export async function saveItem(id: string, list: string, itemId: string | null, _: Result, f: FormData): Promise<Result> {
  const user = await requireUser("admin");
  const fields = LISTS[list];
  if (!fields) return { error: "Unknown list." };
  const data = await load(id);
  if (!data) return { error: "This dealership no longer exists." };
  const item: Record<string, any> = {};
  for (const k of fields) {
    const v = String(f.get(k) ?? "").trim();
    item[k] = v === "" ? null : v;
  }
  if (list === "pricing") {
    if (!item.service) return { error: "Enter the service." };
    if (item.price !== null) {
      const price = Number(String(item.price).replace(/[$,]/g, ""));
      if (!Number.isFinite(price)) return { error: "Price must be a number." };
      item.price = price;
    }
  }
  if (list === "contacts" && !item.name) return { error: "Enter a name." };
  if ((list === "limitations" || list === "announcements") && !item.text) return { error: "Enter the text." };
  if (list === "limitations" || list === "announcements") item.active = f.get("active") === "on";
  const rows: any[] = [...(data[list] ?? [])];
  if (itemId) {
    const i = rows.findIndex((r) => r.id === itemId);
    if (i < 0) return { error: "This item no longer exists." };
    rows[i] = { ...rows[i], ...item };
  } else {
    rows.push({ id: randomUUID(), dealershipId: id, sortOrder: rows.length, ...item });
  }
  return store(user.email, id, { ...data, [list]: rows }, `${itemId ? "update" : "add"} ${list}`);
}

export async function deleteItem(id: string, list: string, itemId: string) {
  const user = await requireUser("admin");
  if (!LISTS[list]) return;
  const data = await load(id);
  if (!data) return;
  await store(user.email, id, { ...data, [list]: (data[list] ?? []).filter((r: any) => r.id !== itemId) }, `delete ${list}`);
}

// ---------- Per-store changes to the Service Data page ----------
// hiddenSections: ids of standard sections this store doesn't show.
// storeSections: sections only this store has, built from blocks (text, callouts, lists, tables, links).
const UUIDISH = /^[0-9a-z-]{8,40}$/i;

export async function setSectionHidden(id: string, sectionId: string, hidden: boolean) {
  const user = await requireUser("admin");
  if (!UUIDISH.test(sectionId)) return;
  const data = await load(id);
  if (!data) return;
  const set = new Set<string>(data.hiddenSections ?? []);
  if (hidden) set.add(sectionId); else set.delete(sectionId);
  await store(user.email, id, { ...data, hiddenSections: [...set] }, `${hidden ? "hide" : "show"} section`);
}

export async function saveStoreSection(id: string, sectionId: string | null, _: Result, f: FormData): Promise<Result> {
  const user = await requireUser("admin");
  const data = await load(id);
  if (!data) return { error: "This dealership no longer exists." };
  let raw: any;
  try { raw = JSON.parse(String(f.get("section") ?? "{}")); } catch { return { error: "Couldn't read this section. Try again." }; }
  const section = cleanSection({ ...raw, id: sectionId ?? randomUUID() });
  if (typeof section === "string") return { error: section };
  const list = [...(data.storeSections ?? [])] as any[];
  if (sectionId) {
    const i = list.findIndex((s) => s.id === sectionId);
    if (i < 0) return { error: "This section no longer exists." };
    list[i] = section;
  } else list.push(section);
  return store(user.email, id, { ...data, storeSections: list }, sectionId ? "update store section" : "add store section");
}

export async function deleteStoreSection(id: string, sectionId: string) {
  const user = await requireUser("admin");
  const data = await load(id);
  if (!data) return;
  await store(user.email, id, { ...data, storeSections: (data.storeSections ?? []).filter((s: any) => s.id !== sectionId) }, "delete store section");
}

export async function moveStoreSection(id: string, sectionId: string, dir: -1 | 1) {
  const user = await requireUser("admin");
  const data = await load(id);
  if (!data) return;
  const list = [...(data.storeSections ?? [])];
  const i = list.findIndex((s: any) => s.id === sectionId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await store(user.email, id, { ...data, storeSections: list }, "move store section");
}
