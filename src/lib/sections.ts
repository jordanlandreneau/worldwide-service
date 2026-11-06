import "server-only";
import { db } from "@/lib/data";

export type SectionField = { key: string; label: string; type: "text" | "long" };
export type Section = { id: string; title: string; sort_order: number; fields: SectionField[]; standard: boolean };

// The Service Data sections admins manage under Stores → Sections. Fields are keys in a store's generalInfo.
export async function loadSections(): Promise<Section[]> {
  const { data } = await db().from("service_sections").select("id,title,sort_order,fields,standard").order("sort_order").order("created_at");
  return ((data ?? []) as any[]).map((s) => ({ ...s, fields: Array.isArray(s.fields) ? s.fields : [] }));
}
