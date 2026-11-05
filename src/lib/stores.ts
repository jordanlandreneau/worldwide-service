"use server";
import { constants, createCipheriv, createPrivateKey, createPublicKey, publicEncrypt, randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/data";
import type { Result } from "@/lib/manage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];
const text = (f: FormData, k: string, max = 2000) => {
  const v = String(f.get(k) ?? "").trim().slice(0, max);
  return v === "" ? null : v;
};
const digits = (v: string | null) => (v ? v.replace(/\D/g, "") : "");
const log = (email: string, table_name: string, row_id: string, action: string) => db().from("edit_log").insert({ user_email: email, table_name, row_id, action });

async function serviceDepartment() {
  const client = db();
  const { data } = await client.from("departments").select("id").ilike("name", "service").maybeSingle();
  if (data?.id) return data.id as string;
  const id = randomUUID();
  await client.from("departments").insert({ id, name: "Service", slug: "service", active: true });
  return id;
}

function refresh(id?: string) {
  revalidatePath("/stores");
  revalidatePath("/service/info");
  revalidatePath("/codes");
  if (id) revalidatePath(`/stores/${id}`);
}

// Adds or edits a Service store. The JustCall numbers are what the Codes page uses to match codes to the store.
export async function saveStore(id: string | null, _: Result, f: FormData): Promise<Result> {
  const user = await requireUser("admin");
  if (id && !UUID.test(id)) return { error: "This store no longer exists." };
  const name = text(f, "name", 200);
  if (!name) return { error: "Enter the store name." };
  const timezone = text(f, "timezone", 64) ?? "America/New_York";
  if (!ZONES.includes(timezone)) return { error: "Choose a time zone." };
  const logo = text(f, "logo_url");
  if (logo && !/^https:\/\//i.test(logo)) return { error: "The logo link must start with https://" };
  const website = text(f, "website");
  const storeLine = text(f, "just_call_number", 40);
  const serviceLine = text(f, "service_just_call_number", 40);
  for (const n of [storeLine, serviceLine]) if (n && digits(n).length < 10) return { error: "JustCall numbers need all 10 digits." };
  const fields = {
    name, address: text(f, "address", 300), phone: text(f, "phone", 40), website, logo_url: logo, timezone,
    just_call_number: storeLine, agent_code_number: text(f, "agent_code_number", 40), special_note: text(f, "special_note", 4000),
    active: f.get("active") !== null || !id, updated_at: new Date().toISOString(),
  };
  const client = db();
  const { data: same } = await client.from("dealerships").select("id").ilike("name", name.replace(/[\\%_]/g, "\\$&"));
  if ((same ?? []).some((s) => s.id !== id)) return { error: "A store with this name already exists." };

  const storeId = id ?? randomUUID();
  if (id) {
    const { error } = await client.from("dealerships").update(fields).eq("id", id);
    if (error) return { error: "Couldn't save this store." };
  } else {
    const { error } = await client.from("dealerships").insert({ ...fields, id: storeId, status: "Active", service_required: true, created_at: fields.updated_at });
    if (error) return { error: "Couldn't add this store." };
  }

  // The Service department line, used for codes and shown with the store.
  const dept = await serviceDepartment();
  const { error: lineError } = await client.from("dealership_departments").upsert({ dealership_id: storeId, department_id: dept, active: true, just_call_number: serviceLine });
  if (lineError) return { error: "The store was saved, but its Service JustCall number wasn't. Try again." };

  // Keep the Service Data record's copy of the name, address and time zone in step.
  const { data: profile } = await client.from("service_profiles").select("data").eq("dealership_id", storeId).maybeSingle();
  const header = { id: storeId, name, address: fields.address, timezone };
  const data = profile?.data
    ? { ...(profile.data as Record<string, unknown>), dealership: { ...((profile.data as any).dealership ?? {}), ...header } }
    : { dealership: header, generalInfo: {}, pricing: [], contacts: [], contactImages: [], limitations: [], announcements: [], hours: [] };
  await client.from("service_profiles").upsert({ dealership_id: storeId, data });

  await log(user.email, "dealerships", storeId, id ? "update store" : "add store");
  refresh(storeId);
  if (!id) redirect(`/stores/${storeId}?added=1`);
  return { ok: true };
}

// Same format as the passwords copied from 4.0, so the reveal code reads old and new alike.
function encryptPassword(id: string, password: string) {
  const pem = process.env.CRM_PRIVATE_KEY;
  if (!pem) throw new Error("Password key is not configured.");
  const publicKey = createPublicKey(createPrivateKey(pem.replace(/\\n/g, "\n")));
  const aesKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  cipher.setAAD(Buffer.from(id));
  const body = Buffer.concat([cipher.update(password, "utf8"), cipher.final(), cipher.getAuthTag()]);
  const wrapped = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, aesKey);
  return `\\x${Buffer.concat([wrapped, iv, body]).toString("hex")}`;
}

export async function saveServiceLogin(storeId: string, id: string | null, _: Result, f: FormData): Promise<Result> {
  const user = await requireUser("admin");
  if (!UUID.test(storeId) || (id && !UUID.test(id))) return { error: "This login no longer exists." };
  const crm_type = text(f, "crm_type", 120);
  const password = String(f.get("password") ?? "");
  if (!crm_type) return { error: "Enter the CRM name, for example Xtime or DealerSocket." };
  if (!id && !password) return { error: "Enter the password." };
  const loginUrl = text(f, "login_url");
  if (loginUrl && !/^https?:\/\//i.test(loginUrl)) return { error: "The login link must start with https://" };
  const dept = await serviceDepartment();
  const rowId = id ?? randomUUID();
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { department_id: dept, crm_type, username: text(f, "username", 300), login_url: loginUrl, updated_at: now };
  try {
    if (password) { row.password_ciphertext = encryptPassword(rowId, password); row.has_password = true; }
  } catch {
    return { error: "The password couldn't be encrypted, so nothing was saved. CRM_PRIVATE_KEY needs to be set in Vercel." };
  }
  const client = db();
  const { error } = id
    ? await client.from("crm_credentials").update(row).eq("id", id).eq("dealership_id", storeId).eq("department_id", dept)
    : await client.from("crm_credentials").insert({ ...row, id: rowId, dealership_id: storeId, created_at: now });
  if (error) return { error: "Couldn't save this login." };
  await log(user.email, "crm_credentials", rowId, id ? "update service login" : "add service login");
  refresh(storeId);
  return { ok: true };
}

export async function deleteServiceLogin(storeId: string, id: string) {
  const user = await requireUser("admin");
  if (!UUID.test(storeId) || !UUID.test(id)) return;
  const dept = await serviceDepartment();
  await db().from("crm_credentials").delete().eq("id", id).eq("dealership_id", storeId).eq("department_id", dept);
  await log(user.email, "crm_credentials", id, "delete service login");
  refresh(storeId);
}

// Service hours live in the store's Service Data record, which is what the Service Data page reads.
export async function saveServiceHours(storeId: string, _: Result, f: FormData): Promise<Result> {
  const user = await requireUser("admin");
  if (!UUID.test(storeId)) return { error: "This store no longer exists." };
  const hours = [];
  for (let day = 0; day < 7; day++) {
    const closed = f.get(`closed_${day}`) !== null;
    const open = text(f, `open_${day}`, 5);
    const close = text(f, `close_${day}`, 5);
    if (!closed && !open && !close) continue;
    if (!closed && (!open || !close)) return { error: "Enter open and close times, or mark the day closed." };
    if (!closed && open! >= close!) return { error: "Close time must be after open time." };
    hours.push({ departmentName: "Service", dayOfWeek: day, closed, openTime: closed ? null : open, closeTime: closed ? null : close });
  }
  const client = db();
  const { data: profile } = await client.from("service_profiles").select("data").eq("dealership_id", storeId).maybeSingle();
  if (!profile) return { error: "Save the store first." };
  const data = profile.data as Record<string, any>;
  const other = (data.hours ?? []).filter((h: any) => h.departmentName !== "Service");
  const { error } = await client.from("service_profiles").update({ data: { ...data, hours: [...other, ...hours] } }).eq("dealership_id", storeId);
  if (error) return { error: "Couldn't save these hours." };
  await log(user.email, "service_profiles", storeId, "update hours");
  refresh(storeId);
  return { ok: true };
}
