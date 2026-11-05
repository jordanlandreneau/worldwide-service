"use server";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/data";
import { codeCutoff, syncCodes } from "@/lib/justcall";

export async function refreshCodes(): Promise<{ latest: string | null; error?: string }> {
  await requireUser();
  const { error } = await syncCodes();
  const { data } = await db().from("verification_codes").select("sms_at").gte("sms_at", codeCutoff()).order("sms_at", { ascending: false }).limit(1).maybeSingle();
  return { latest: (data?.sms_at as string | undefined) ?? null, error };
}
