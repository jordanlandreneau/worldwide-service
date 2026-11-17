"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { atLeast } from "@/lib/access";
import { db } from "@/lib/data";
import type { Result } from "@/lib/manage";
import { localToUtc, requireScoped } from "@/lib/scope";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["set", "showed", "no_show", "cancelled", "rescheduled"];
const text = (f: FormData, k: string, max = 2000) => {
  const v = String(f.get(k) ?? "").trim().slice(0, max);
  return v === "" ? null : v;
};

// Reads and checks the appointment form. The dealership comes from the form's own dropdown, so a
// wrong pick can be changed before (or after) saving. A campaign from another store is dropped.
async function readForm(f: FormData, fallbackStore: string) {
  const client = db();
  const storeId = text(f, "dealership_id", 64) ?? fallbackStore;
  if (!UUID.test(storeId)) return { error: "Choose a dealership." } as const;
  const { data: store } = await client.from("dealerships").select("id,timezone").eq("id", storeId).maybeSingle();
  if (!store) return { error: "Choose a dealership." } as const;
  const name = text(f, "customer_name", 200);
  const phone = text(f, "phone", 40);
  const date = text(f, "date", 10);
  const time = text(f, "time", 5);
  if (!name) return { error: "Enter the customer's name." } as const;
  if (!phone || phone.replace(/\D/g, "").length < 10) return { error: "Enter the customer's 10-digit phone number." } as const;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || !/^\d{2}:\d{2}$/.test(time)) return { error: "Choose the appointment date and time." } as const;
  let campaignId = text(f, "campaign_id", 64);
  if (campaignId) {
    const { data: c } = UUID.test(campaignId) ? await client.from("campaigns").select("id").eq("id", campaignId).eq("dealership_id", storeId).maybeSingle() : { data: null };
    if (!c) campaignId = null;
  }
  let at: Date;
  try { at = localToUtc(date, time, (store.timezone as string | null) ?? "America/New_York"); } catch { return { error: "Choose the appointment date and time." } as const; }
  return { fields: { dealership_id: storeId, customer_name: name, phone, appt_at: at.toISOString(), campaign_id: campaignId, notes: text(f, "notes", 2000) } } as const;
}

// Worldwide staff set appointments. No text is sent: the store's CRM confirms them.
export async function saveAppointment(storeId: string, _: Result, f: FormData): Promise<Result> {
  const { user, stores } = await requireScoped();
  if (user.role === "dealership") return { error: "You don't have access to this." };
  const r = await readForm(f, storeId);
  if ("error" in r) return { error: r.error };
  if (stores !== null && !stores.includes(r.fields.dealership_id)) return { error: "You don't have access to that dealership." };
  const { error } = await db().from("appointments").insert({ ...r.fields, created_by: user.email });
  if (error) return { error: "Couldn't save this appointment." };
  revalidatePath("/appointments");
  revalidatePath("/command");
  redirect(`/appointments?d=${r.fields.dealership_id}&added=1`);
}

// Fix a saved appointment (wrong dealership, time, phone…). The person who set it, or a manager.
export async function updateAppointment(id: string, _: Result, f: FormData): Promise<Result> {
  const { user, stores } = await requireScoped();
  if (user.role === "dealership" || !UUID.test(id)) return { error: "You don't have access to this." };
  const client = db();
  const { data: appt } = await client.from("appointments").select("id,dealership_id,created_by").eq("id", id).maybeSingle();
  if (!appt) return { error: "This appointment no longer exists." };
  if (!atLeast(user.role, "manager") && String(appt.created_by).toLowerCase() !== user.email.toLowerCase()) return { error: "Only the person who set it or a manager can change it." };
  const r = await readForm(f, appt.dealership_id);
  if ("error" in r) return { error: r.error };
  if (stores !== null && !stores.includes(r.fields.dealership_id)) return { error: "You don't have access to that dealership." };
  const { error } = await client.from("appointments").update({ ...r.fields, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: "Couldn't save the changes." };
  await client.from("edit_log").insert({ user_email: user.email, table_name: "appointments", row_id: id, action: appt.dealership_id !== r.fields.dealership_id ? "move appointment to another dealership" : "edit appointment" });
  revalidatePath("/appointments");
  revalidatePath("/command");
  return { ok: true };
}

export async function setAppointmentStatus(id: string, f: FormData) {
  const { user } = await requireScoped();
  if (!atLeast(user.role, "manager") || !UUID.test(id)) return;
  const status = String(f.get("status") ?? "");
  if (!STATUSES.includes(status)) return;
  await db().from("appointments").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/appointments");
}

export async function deleteAppointment(id: string) {
  const { user } = await requireScoped();
  if (!atLeast(user.role, "manager") || !UUID.test(id)) return;
  await db().from("appointments").delete().eq("id", id);
  await db().from("edit_log").insert({ user_email: user.email, table_name: "appointments", row_id: id, action: "delete appointment" });
  revalidatePath("/appointments");
}
