"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/data";
import type { Result } from "@/lib/manage";
import { notifyAssigned } from "@/lib/assignments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refresh = (id: string) => { revalidatePath(`/stores/${id}`); revalidatePath("/stores"); revalidatePath("/command"); };

// Managers and admins put an agent or a whole team on a store, optionally with a deadline and a note.
export async function addAssignment(storeId: string, _: Result, f: FormData): Promise<Result> {
  const user = await requireUser("manager");
  if (!UUID.test(storeId)) return { error: "This store no longer exists." };
  const [kind, id] = String(f.get("who") ?? "").split(":");
  if (!UUID.test(id ?? "") || (kind !== "user" && kind !== "team")) return { error: "Choose an agent or a team." };
  const store = (await db().from("dealerships").select("name,timezone").eq("id", storeId).maybeSingle()).data as any;
  if (!store) return { error: "This store no longer exists." };
  const note = String(f.get("note") ?? "").trim().slice(0, 500) || null;
  const { error } = await db().from("store_assignments").insert({ dealership_id: storeId, [kind === "user" ? "user_id" : "team_id"]: id, note, created_by: user.email });
  if (error) return { error: error.code === "23505" ? "Already assigned to this store." : "Couldn't assign." };
  if (kind === "user") {
    await notifyAssigned({ userId: id, storeId, storeName: store.name, what: note ? `Store assignment: ${note}` : "You're on this store.", dueText: null, link: `/command?d=${storeId}`, by: user }).catch(() => undefined);
  }
  refresh(storeId);
  return { ok: true };
}

export async function removeAssignment(storeId: string, id: string) {
  await requireUser("manager");
  if (!UUID.test(storeId) || !UUID.test(id)) return;
  await db().from("store_assignments").delete().eq("id", id).eq("dealership_id", storeId);
  refresh(storeId);
}
