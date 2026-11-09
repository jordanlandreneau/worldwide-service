"use server";
import { revalidatePath } from "next/cache";
import { atLeast, requireUser } from "@/lib/access";
import { db } from "@/lib/data";
import { OUTCOMES } from "@/lib/list-status";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Agents on the sheet (and managers) record what happened with one customer.
async function canWork(listId: string) {
  const user = await requireUser();
  if (!UUID.test(listId)) return null;
  if (atLeast(user.role, "manager")) return user;
  if (!user.id) return null;
  const { data } = await db().from("list_assignments").select("id").eq("list_id", listId).eq("user_id", user.id).maybeSingle();
  return data ? user : null;
}

export async function markRow(listId: string, rowIndex: number, f: FormData) {
  const user = await canWork(listId);
  if (!user || !Number.isInteger(rowIndex) || rowIndex < 0) return;
  const status = String(f.get("status") ?? "");
  if (!OUTCOMES.some((o) => o.value === status)) return;
  const note = String(f.get("note") ?? "").trim().slice(0, 1000) || null;
  const client = db();
  const row = { list_id: listId, row_index: rowIndex, status, note, user_id: user.id, user_name: user.name, updated_at: new Date().toISOString() };
  await client.from("list_progress").upsert(row);
  await client.from("list_progress_log").insert({ list_id: listId, row_index: rowIndex, status, note, user_id: user.id, user_name: user.name });
  revalidatePath(`/my-work/list/${listId}`);
  revalidatePath("/my-work");
}

export async function clearRow(listId: string, rowIndex: number) {
  const user = await canWork(listId);
  if (!user || !Number.isInteger(rowIndex)) return;
  await db().from("list_progress").delete().eq("list_id", listId).eq("row_index", rowIndex);
  revalidatePath(`/my-work/list/${listId}`);
  revalidatePath("/my-work");
}
