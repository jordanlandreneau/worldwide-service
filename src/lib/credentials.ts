"use server";
import { atLeast, requireUser } from "@/lib/access";
import { db } from "@/lib/data";
import { decryptCrmPassword as decrypt } from "@/lib/crm-decrypt";

// context "info": Dealership Info, every store rule must be acknowledged.
// context "manage": the dealership record page, managers and admins only, as on 3.0.
export async function revealPassword(
  credentialId: string,
  context: "info" | "manage",
  acknowledged: string[],
): Promise<{ password?: string; error?: string }> {
  const user = await requireUser();
  if (context === "manage" && !atLeast(user.role, "manager")) return { error: "You don't have access to this." };
  const client = db();
  const { data: cred } = await client
    .from("crm_credentials")
    .select("id,dealership_id,password_ciphertext")
    .eq("id", credentialId)
    .maybeSingle();
  if (!cred?.password_ciphertext) return { error: "No password is stored for this login." };

  const { data: rules } = await client.from("store_rules").select("id").eq("dealership_id", cred.dealership_id);
  const required = (rules ?? []).map((r) => r.id as string);
  if (context === "info" && required.some((id) => !acknowledged.includes(id))) {
    return { error: "Acknowledge every store rule first." };
  }
  const { error: logError } = await client.from("credential_reveal_log").insert({
    credential_id: cred.id,
    dealership_id: cred.dealership_id,
    user_email: user.email,
    user_role: user.role,
    context,
    rules_acknowledged: context === "info" ? required.length : 0,
  });
  if (logError) return { error: "Couldn't record this reveal, so the password stays locked." };
  try {
    return { password: decrypt(cred.password_ciphertext as string, cred.id as string) };
  } catch {
    return { error: "This password couldn't be decrypted." };
  }
}
