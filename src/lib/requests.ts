"use server";
import { revalidatePath } from "next/cache";
import { atLeast } from "@/lib/access";
import { db } from "@/lib/data";
import { escapeHtml as esc, sendMail } from "@/lib/mail";
import type { Result } from "@/lib/manage";
import { requireScoped } from "@/lib/scope";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CATEGORIES = ["Service Data", "Hours", "Contacts", "Pricing", "Logins", "Campaigns", "Reference Library", "Something else"];
const STATUSES = ["open", "in_progress", "done", "declined"];
// Who gets the email. CHANGE_REQUEST_EMAILS in Vercel (comma separated) overrides this list.
const RECIPIENTS = () => (process.env.CHANGE_REQUEST_EMAILS ?? "lauren@worldwidebdc.com,leanetm@worldwidebdc.com").split(",").map((s) => s.trim()).filter(Boolean);
const site = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

export async function submitRequest(_: Result, f: FormData): Promise<Result> {
  const { user, stores } = await requireScoped();
  const storeId = String(f.get("dealership_id") ?? "").trim() || null;
  if (storeId && (!UUID.test(storeId) || (stores !== null && !stores.includes(storeId)))) return { error: "Choose one of your stores." };
  if (!storeId && user.role === "dealership") return { error: "Choose the store this is for." };
  const category = String(f.get("category") ?? "");
  if (!CATEGORIES.includes(category)) return { error: "Choose what needs changing." };
  const details = String(f.get("details") ?? "").trim().slice(0, 5000);
  if (details.length < 5) return { error: "Describe the change you need." };
  const client = db();
  const { data: store } = storeId ? await client.from("dealerships").select("name").eq("id", storeId).maybeSingle() : { data: null };
  const { data: row, error } = await client.from("change_requests").insert({
    dealership_id: storeId, category, details, requested_by: user.email, requester_name: user.name,
  }).select("id").single();
  if (error || !row) return { error: "Couldn't send this request." };
  const storeName = (store?.name as string | undefined) ?? "No specific store";
  const sent = await sendMail({
    to: RECIPIENTS(),
    replyTo: user.email,
    subject: `Change request: ${storeName} · ${category}`,
    html: `<p style="font-size:18px;font-weight:600">New change request on Worldwide Service</p>
<p><strong>Store:</strong> ${esc(storeName)}<br><strong>What:</strong> ${esc(category)}<br><strong>From:</strong> ${esc(user.name)} (${esc(user.email)})</p>
<p style="white-space:pre-wrap;border-left:3px solid #1f5fbf;padding-left:12px">${esc(details)}</p>
<p><a href="${esc(site())}/requests">Open change requests</a></p>`,
  });
  await client.from("change_requests").update({ emailed: sent }).eq("id", row.id);
  revalidatePath("/requests");
  return { ok: true };
}

export async function setRequestStatus(id: string, f: FormData) {
  const { user } = await requireScoped();
  if (!atLeast(user.role, "manager") || !UUID.test(id)) return;
  const status = String(f.get("status") ?? "");
  if (!STATUSES.includes(status)) return;
  await db().from("change_requests").update({ status, handled_by: user.email, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/requests");
}
