"use server";
import { googleAddMember, googleRemoveMember } from "@/lib/follow-providers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/data";
import { type Chat, deliver, type Extras, followUpText, type Member, whatsappNames } from "@/lib/follow-send";
import { type Mention, storeUploads } from "@/lib/follow-media";
import type { Result } from "@/lib/manage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = ["whatsapp", "teams", "email", "google_chat", "sms", "slack"];
const text = (f: FormData, k: string, max = 2000) => {
  const v = String(f.get(k) ?? "").trim().slice(0, max);
  return v === "" ? null : v;
};
const refresh = (id?: string) => { revalidatePath("/follow-up"); if (id) revalidatePath(`/follow-up/${id}`); };

async function loadChat(id: string) {
  if (!UUID.test(id)) return null;
  const client = db();
  const [{ data: chat }, { data: members }] = await Promise.all([
    client.from("follow_chats").select("id,name,channel,whatsapp_group_id,teams_chat_id,google_chat_space,dealership_id,justcall_line,justcall_group_id,slack_channel_id,active").eq("id", id).maybeSingle(),
    client.from("follow_members").select("name,phone,email").eq("chat_id", id),
  ]);
  return chat ? { chat: chat as Chat & { active: boolean }, members: (members ?? []) as Member[] } : null;
}

// Pictures picked in the composer and the people @-mentioned (sent as JSON by the composer).
async function readExtras(chatId: string, f: FormData): Promise<Extras | string> {
  const files = f.getAll("pictures").filter((x): x is File => typeof x === "object" && "arrayBuffer" in x && (x as File).size > 0);
  const up = files.length ? await storeUploads(chatId, files) : { list: [] };
  if (up.error) return up.error;
  let mentions: Mention[] = [];
  try { mentions = (JSON.parse(String(f.get("mentions") ?? "[]")) as Mention[]).filter((m) => m && typeof m.name === "string").slice(0, 20); } catch { /* none */ }
  return { attachments: up.list, mentions };
}

async function send(chatId: string, body: string, subject: string, extra: Record<string, unknown>, by: { email: string; name: string }, extras: Extras = {}): Promise<Result> {
  const found = await loadChat(chatId);
  if (!found) return { error: "This chat no longer exists." };
  if (!found.chat.active) return { error: "This chat is turned off. A manager can turn it back on." };
  const result = await deliver(found.chat, found.members, body, subject, by.email, extras);
  const client = db();
  await client.from("follow_messages").insert({
    chat_id: chatId, direction: "outbound", body, sender_name: by.name, sender: by.email, ...extra, attachments: extras.attachments ?? [], mentions: extras.mentions ?? [],
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
  const extras = await readExtras(chatId, f);
  if (typeof extras === "string") return { error: extras };
  const body = text(f, "body", 4000) ?? "";
  if (!body && !extras.attachments?.length) return { error: "Type a message or add a picture." };
  const client = db();
  const { data: chat } = await client.from("follow_chats").select("name").eq("id", chatId).maybeSingle();
  // A reply is linked to the store message it answers, and that message is marked answered once it sends.
  const replyTo = text(f, "reply_to", 64);
  const { data: original } = replyTo && UUID.test(replyTo)
    ? await client.from("follow_messages").select("id").eq("id", replyTo).eq("chat_id", chatId).eq("direction", "inbound").maybeSingle()
    : { data: null };
  const result = await send(chatId, body, `Re: ${chat?.name ?? "Follow up"}`, original ? { reply_to: original.id } : {}, by, extras);
  if (result.ok && original) {
    await client.from("follow_messages").update({ handled_kind: "answered", handled_by: by.email, handled_name: by.name, handled_at: new Date().toISOString(), read: true }).eq("id", original.id);
    refresh(chatId);
  }
  return result;
}

// "Got it" without replying in the chat: the message counts as handled and shows who acknowledged it.
export async function acknowledge(chatId: string, id: string) {
  const by = await sender();
  if (!UUID.test(chatId) || !UUID.test(id)) return;
  await db().from("follow_messages").update({ handled_kind: "acknowledged", handled_by: by.email, handled_name: by.name, handled_at: new Date().toISOString(), read: true })
    .eq("id", id).eq("chat_id", chatId).eq("direction", "inbound").is("handled_kind", null);
  refresh(chatId);
}

export async function reopen(chatId: string, id: string) {
  await sender();
  if (!UUID.test(chatId) || !UUID.test(id)) return;
  await db().from("follow_messages").update({ handled_kind: null, handled_by: null, handled_name: null, handled_at: null }).eq("id", id).eq("chat_id", chatId);
  refresh(chatId);
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
    google_chat_space: text(f, "google_chat_space", 120), justcall_line: text(f, "justcall_line", 40), slack_channel_id: text(f, "slack_channel_id", 120),
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
  const name = text(f, "name", 120) ?? "Unnamed";
  const email = text(f, "email", 200)?.toLowerCase() ?? null;
  const phone = text(f, "phone", 40);
  if (!email && !phone) return { error: "Enter an email or a phone number." };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "That email address doesn't look right." };
  const { error } = await db().from("follow_members").insert({ chat_id: chatId, name, email, phone, role: text(f, "role", 40) ?? "member" });
  if (error) return { error: "Couldn't add this person." };
  refresh(chatId);
  // Google Chat: the Roster is the space's membership, so add them to the space too.
  if (email) {
    const { data: chat } = await db().from("follow_chats").select("channel,google_chat_space").eq("id", chatId).maybeSingle();
    if (chat?.channel === "google_chat" && chat.google_chat_space) {
      const r = await googleAddMember(chat.google_chat_space, email);
      if (!r.ok) return { error: r.error };
    }
  }
  return { ok: true };
}

export async function removeMember(chatId: string, id: string) {
  await requireUser("manager");
  if (!UUID.test(chatId) || !UUID.test(id)) return;
  const client = db();
  const { data: m } = await client.from("follow_members").select("email").eq("id", id).eq("chat_id", chatId).maybeSingle();
  await client.from("follow_members").delete().eq("id", id).eq("chat_id", chatId);
  const { data: chat } = await client.from("follow_chats").select("channel,google_chat_space").eq("id", chatId).maybeSingle();
  if (m?.email && chat?.channel === "google_chat" && chat.google_chat_space) await googleRemoveMember(chat.google_chat_space, m.email);
  refresh(chatId);
}

// Paste one person per line: "Name, phone, email" (any order after the name; phone and email are spotted by shape).
export async function bulkAddMembers(chatId: string, _: Result, f: FormData): Promise<Result> {
  await requireUser("manager");
  if (!UUID.test(chatId)) return { error: "This chat no longer exists." };
  const lines = String(f.get("lines") ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 500);
  if (!lines.length) return { error: "Paste at least one person." };
  const rows = [];
  for (const line of lines) {
    const parts = line.split(/[,\t;|]/).map((p) => p.trim()).filter(Boolean);
    const email = parts.find((p) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p))?.toLowerCase() ?? null;
    const phone = parts.find((p) => p.replace(/\D/g, "").length >= 10 && !p.includes("@")) ?? null;
    const name = parts.find((p) => p !== email && p !== phone && !/^[\d\s()+.-]+$/.test(p)) ?? "Unnamed";
    if (!email && !phone) return { error: `"${line.slice(0, 60)}" has no phone or email.` };
    rows.push({ chat_id: chatId, name: name.slice(0, 120), phone, email });
  }
  const { error } = await db().from("follow_members").insert(rows);
  if (error) return { error: "Couldn't add these people." };
  refresh(chatId);
  const { data: chat } = await db().from("follow_chats").select("channel,google_chat_space").eq("id", chatId).maybeSingle();
  if (chat?.channel === "google_chat" && chat.google_chat_space) {
    const failed: string[] = [];
    for (const r of rows) if (r.email) { const x = await googleAddMember(chat.google_chat_space, r.email); if (!x.ok) failed.push(`${r.email}: ${x.error}`); }
    if (failed.length) return { error: `Saved to the Roster, but not added to the Google Chat space: ${failed.slice(0, 3).join(" · ")}` };
  }
  return { ok: true };
}

export async function setMemberEmail(chatId: string, id: string, _: Result, f: FormData): Promise<Result> {
  await requireUser("manager");
  if (!UUID.test(chatId) || !UUID.test(id)) return { error: "This person no longer exists." };
  const email = text(f, "email", 200)?.toLowerCase() ?? null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "That email address doesn't look right." };
  const { error } = await db().from("follow_members").update({ email }).eq("id", id).eq("chat_id", chatId);
  if (error) return { error: "Couldn't save this email." };
  refresh(chatId);
  return { ok: true };
}

export async function syncGoogleChat(chatId: string, _: Result, __: FormData): Promise<Result> {
  await requireUser("manager");
  if (!UUID.test(chatId)) return { error: "This chat no longer exists." };
  const { backfillGoogleChat } = await import("@/lib/follow-sync");
  const r = await backfillGoogleChat(chatId);
  refresh(chatId);
  if (!r.messages && !r.people && r.unknown) return { error: `No new messages or people. ${r.unknown} people in the space couldn't be looked up; a manager should click Reconnect & import spaces once so the site can read the company directory.` };
  return { ok: true };
}

export async function syncWhatsAppNames(chatId: string, _: Result, __: FormData): Promise<Result> {
  await requireUser("manager");
  const found = await loadChat(chatId);
  if (!found?.chat.whatsapp_group_id) return { error: "This chat has no WhatsApp group id." };
  const names = await whatsappNames(found.chat.whatsapp_group_id);
  if (typeof names === "string") return { error: names };
  const client = db();
  const { data: people } = await client.from("follow_members").select("id,phone,name").eq("chat_id", chatId);
  let changed = 0;
  for (const p of (people ?? []) as any[]) {
    const n = names.get(String(p.phone ?? "").replace(/\D/g, "").slice(-10));
    if (n && n !== p.name) { await client.from("follow_members").update({ name: n }).eq("id", p.id); changed++; }
  }
  refresh(chatId);
  return changed ? { ok: true } : { error: "Names already match WhatsApp." };
}

export async function deleteChat(id: string) {
  await requireUser("manager");
  if (!UUID.test(id)) return;
  await db().from("follow_chats").delete().eq("id", id);
  revalidatePath("/follow-up");
  redirect("/follow-up");
}
