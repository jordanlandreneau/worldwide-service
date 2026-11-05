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

// Worldwide staff set appointments. No text is sent: the store's CRM confirms them.
export async function saveAppointment(storeId: string, _: Result, f: FormData): Promise<Result> {
  const { user } = await requireScoped();
  if (user.role === "dealership") return { error: "You don't have access to this." };
  if (!UUID.test(storeId)) return { error: "Choose a store." };
  const client = db();
  const { data: store } = await client.from("dealerships").select("id,timezone").eq("id", storeId).maybeSingle();
  if (!store) return { error: "Choose a store." };
  const name = text(f, "customer_name", 200);
  const phone = text(f, "phone", 40);
  const date = text(f, "date", 10);
  const time = text(f, "time", 5);
  if (!name) return { error: "Enter the customer's name." };
  if (!phone || phone.replace(/\D/g, "").length < 10) return { error: "Enter the customer's 10-digit phone number." };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || !/^\d{2}:\d{2}$/.test(time)) return { error: "Choose the appointment date and time." };
  const campaignId = text(f, "campaign_id", 64);
  if (campaignId) {
    const { data: c } = await client.from("campaigns").select("id").eq("id", campaignId).eq("dealership_id", storeId).maybeSingle();
    if (!c) return { error: "Choose a campaign from this store." };
  }
  let at: Date;
  try { at = localToUtc(date, time, (store.timezone as string | null) ?? "America/New_York"); } catch { return { error: "Choose the appointment date and time." }; }
  const { error } = await client.from("appointments").insert({
    dealership_id: storeId, customer_name: name, phone, appt_at: at.toISOString(), campaign_id: campaignId,
    notes: text(f, "notes", 2000), created_by: user.email,
  });
  if (error) return { error: "Couldn't save this appointment." };
  revalidatePath("/appointments");
  revalidatePath("/command");
  redirect(`/appointments?d=${storeId}&added=1`);
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
