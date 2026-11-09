"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/data";
import { codeCutoff, syncCodes } from "@/lib/justcall";

export async function refreshCodes(): Promise<{ latest: string | null; error?: string }> {
  await requireUser();
  const { error } = await syncCodes();
  const { data } = await db().from("verification_codes").select("sms_at").gte("sms_at", codeCutoff()).order("sms_at", { ascending: false }).limit(1).maybeSingle();
  return { latest: (data?.sms_at as string | undefined) ?? null, error };
}

// Links a JustCall line to a store, so its codes are labeled with that store from now on.
// The line becomes the store's line (or its Service line if the store already has one),
// and the last 24 hours of codes on that line are moved to the store.
export async function linkCodeLine(line: string, _: unknown, f: FormData): Promise<{ ok?: boolean; error?: string }> {
  const user = await requireUser("admin");
  const storeId = String(f.get("store") ?? "");
  const digits = line.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return { error: "That line isn't a full phone number." };
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return { error: "Choose a store." };
  const client = db();
  const { data: store } = await client.from("dealerships").select("id,name,just_call_number").eq("id", storeId).maybeSingle();
  if (!store) return { error: "That store no longer exists." };
  const pretty = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (!store.just_call_number) {
    const { error } = await client.from("dealerships").update({ just_call_number: pretty, updated_at: new Date().toISOString() }).eq("id", storeId);
    if (error) return { error: "Couldn't link the line." };
  } else {
    const { data: dept } = await client.from("departments").select("id").ilike("name", "service").maybeSingle();
    if (!dept?.id) return { error: "Couldn't find the Service department." };
    const { error } = await client.from("dealership_departments").upsert({ dealership_id: storeId, department_id: dept.id, active: true, just_call_number: pretty });
    if (error) return { error: "Couldn't link the line." };
  }
  const { data: codes } = await client.from("verification_codes").select("justcall_sms_id,justcall_number").is("dealership_id", null).gte("sms_at", codeCutoff());
  const ids = ((codes ?? []) as any[]).filter((c) => String(c.justcall_number ?? "").replace(/\D/g, "").slice(-10) === digits).map((c) => c.justcall_sms_id);
  if (ids.length) await client.from("verification_codes").update({ dealership_id: storeId }).in("justcall_sms_id", ids);
  await client.from("edit_log").insert({ user_email: user.email, table_name: "dealerships", row_id: storeId, action: `linked JustCall line ${pretty} for codes` });
  revalidatePath("/codes");
  revalidatePath(`/stores/${storeId}`);
  return { ok: true };
}
