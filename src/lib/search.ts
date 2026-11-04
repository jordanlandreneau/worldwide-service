"use server";
import { getUser } from "@/lib/access";
import { db } from "@/lib/data";

export type Found = { kind: "Store" | "Page"; label: string; note?: string; href: string };

// Top-bar search: Service stores and Service pages.
export async function globalSearch(term: string): Promise<Found[]> {
  const user = await getUser();
  if (!user || user.role === "dealership") return [];
  const q = term.trim().replace(/[%,()*\\]/g, "");
  if (q.length < 2) return [];
  const client = db();
  const [{ data: stores }, { data: pages }] = await Promise.all([
    client.from("dealerships").select("id,name,active").ilike("name", `%${q}%`).eq("active", true).order("name").limit(8),
    client.from("service_pages").select("path,title").ilike("title", `%${q}%`).order("title").limit(8),
  ]);
  return [
    ...((stores ?? []) as { id: string; name: string }[]).map((s) => ({ kind: "Store" as const, label: s.name, href: `/service/info?d=${s.id}` })),
    ...((pages ?? []) as { path: string; title: string | null }[]).map((p) => ({ kind: "Page" as const, label: p.title || p.path, href: p.path })),
  ];
}
