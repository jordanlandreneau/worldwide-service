"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/data";
import { type Chat, deliver, followUpText, type Member } from "@/lib/follow-send";
import type { Result } from "@/lib/manage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = ["whatsapp", "teams", "email", "google_chat", "sms"];
const text = (f: FormData, k: string, max = 2000) => {
  const v = String(f.get(k) ?? "").trim().slice(0, max);
  return v === "" ? null : v;
};
const refresh = (id?: string) => { revalidatePath("/follow-up"); if (id) revalidatePath(`/follow-up/${id}`); };

async function loadChat(id: string) {
  if (!UUID.test(id)) return null;
  const client = db();
  const [{ data: chat }, { data: members }] = await Promise.all([
    client.from("follow_chats").select("id,name,channel,whatsapp_group_id,teams_chat_id,google_chat_space,linq_group_id,active").eq("id", id).maybeSingle(),
    client.from("follow_members").select("name,phone,email").eq("chat_id", id),
  ]);
  return chat ? { chat: chat as Chat & { active: boolean }, members: (members ?? []) as Member[] } : null;
}

async function send(chatId: string, body: string, subject: string, extra: Record<string, unknown>, by: { email: string; name: string }): Promise<Result> {
  const found = await loadChat(chatId);
  if (!found) return { error: "This chat no longer exists." };
  if (!found.chat.active) return { error: "This chat is turned off. A manager can turn it back on." };
  const result = await deliver(found.chat, found.members, body, subject);
  const client = db();
  await client.from("follow_messages").insert({
    chat_id: chatId, direction: "outbound", body, sender_name: by.name, sender: by.email, ...extra,
    status: result.ok ? "sent" : "failed", error: result.ok ? null : result.error, external_id: result.ok ? result.externalId ?? null : null,
    read: true, created_by: by.email,
  });
  if (result.ok) await client.from("follow_chats").update({ last_activity: new Date().toISOString() }).eq("id", chatId);
  refresh(chatId);
  return result.ok ? { ok: true } : { error: `${result.error} The message is saved here as not sent.` };
}

// Agents and up send follow-ups. Store logins don't use this page.
async function sender() {
  const user = await requireUser("agent");
  return { email: user.email, name: user.name || user.email };
}

export async function sendFollowUp(chatId: string, _: Result, f: FormData): Promise<Result> {
  const by = await sender();
  const customer = text(f, "customer_name", 120);
  const phone = text(f, "customer_phone", 40);
  const reason = text(f, "reason", 2000);
  if (!customer) return { error: "Enter the customer's name." };
  if (!phone || phone.replace(/\D/g, "").length < 10) return { error: "Enter the customer's 10-digit phone number." };
  if (!reason) return { error: "Enter the reason for the call." };
  const fields = { customer, phone, vehicle: text(f, "vehicle", 160), vin: text(f, "vin", 20)?.toUpperCase() ?? null, advisor: text(f, "advisor", 120), reason };
  const body = followUpText(fields);
  return send(chatId, body, `Follow up: ${customer}`, {
    kind: "follow_up", customer_name: customer, customer_phone: phone, vehicle: fields.vehicle, vin: fields.vin, advisor: fields.advisor, reason,
  }, by);
}

export async function sendReply(chatId: string, _: Result, f: FormData): Promise<Result> {
  const by = await sender();
  const body = text(f, "body", 4000);
  if (!body) return { error: "Type a message." };
  const { data: chat } = await db().from("follow_chats").select("name").eq("id", chatId).maybeSingle();
  return send(chatId, body, `Re: ${chat?.name ?? "Follow up"}`, {}, by);
}

export async function markRead(chatId: string) {
  await requireUser("agent");
  if (!UUID.test(chatId)) return;
  await db().from("follow_messages").update({ read: true }).eq("chat_id", chatId).eq("direction", "inbound").eq("read", false);
  refresh(chatId);
}

// Managers and admins set chats up.
export async function saveChat(id: string | null, _: Result, f: FormData): Promise<Result> {
  const user = await requireUser("manager");
  if (id && !UUID.test(id)) return { error: "This chat no longer exists." };
  const name = text(f, "name", 200);
  const channel = text(f, "channel", 20) ?? "";
  if (!name) return { error: "Enter the chat's name." };
  if (!CHANNELS.includes(channel)) return { error: "Choose a channel." };
  const store = text(f, "dealership_id", 64);
  if (store && !UUID.test(store)) return { error: "Choose a store." };
  const fields = {
    name, channel, dealership_id: store,
    whatsapp_group_id: text(f, "whatsapp_group_id", 120), teams_chat_id: text(f, "teams_chat_id", 200),
    google_chat_space: text(f, "google_chat_space", 120), linq_group_id: text(f, "linq_group_id", 120),
    active: id ? f.get("active") !== null : true,
  };
  const client = db();
  if (id) {
    const { error } = await client.from("follow_chats").update(fields).eq("id", id);
    if (error) return { error: "Couldn't save this chat." };
    refresh(id);
    return { ok: true };
  }
  const { data, error } = await client.from("follow_chats").insert({ ...fields, created_by: user.email }).select("id").single();
  if (error || !data) return { error: "Couldn't add this chat." };
  refresh();
  redirect(`/follow-up?chat=${data.id}`);
}

export async function addMember(chatId: string, _: Result, f: FormData): Promise<Result> {
  await requireUser("manager");
  if (!UUID.test(chatId)) return { error: "This chat no longer exists." };
  const name = text(f, "name", 120);
  const email = text(f, "email", 200)?.toLowerCase() ?? null;
  const phone = text(f, "phone", 40);
  if (!name) return { error: "Enter the person's name." };
  if (!email && !phone) return { error: "Enter an email or a phone number." };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "That email address doesn't look right." };
  const { error } = await db().from("follow_members").insert({ chat_id: chatId, name, email, phone, role: text(f, "role", 40) ?? "member" });
  if (error) return { error: "Couldn't add this person." };
  refresh(chatId);
  return { ok: true };
}

export async function removeMember(chatId: string, id: string) {
  await requireUser("manager");
  if (!UUID.test(chatId) || !UUID.test(id)) return;
  await db().from("follow_members").delete().eq("id", id).eq("chat_id", chatId);
  refresh(chatId);
}
