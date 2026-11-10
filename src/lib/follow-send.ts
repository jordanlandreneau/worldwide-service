import "server-only";
import { escapeHtml } from "@/lib/mail";
import { googleChatReady, googleChatSend, linqReady, linqSend, linqStart, teamsConfigured, teamsSend } from "@/lib/follow-providers";
import { db } from "@/lib/data";

// Delivers a message to a dealership chat on its own channel.
// Each channel turns on when its keys are set in Vercel; until then it says what's missing.

export type Chat = {
  id: string; name: string; channel: "whatsapp" | "teams" | "email" | "google_chat" | "sms" | "slack";
  whatsapp_group_id: string | null; teams_chat_id: string | null; google_chat_space: string | null; linq_group_id: string | null; slack_channel_id?: string | null;
};
export type Member = { name: string; phone: string | null; email: string | null };
export type Sent = { ok: true; externalId?: string } | { ok: false; error: string };

export { CHANNEL_NAMES as CHANNELS } from "@/lib/follow-channels";
import { CHANNEL_NAMES as CHANNELS } from "@/lib/follow-channels";

export function channelReady(channel: Chat["channel"]) {
  if (channel === "email") return !!(process.env.RESEND_API_KEY && (process.env.FOLLOW_UP_EMAIL_FROM || process.env.INVITE_EMAIL_FROM));
  if (channel === "whatsapp") return !!((process.env.PERISKOPE_API_KEY ?? process.env.PERISKOPE_API) && process.env.PERISKOPE_PHONE);
  if (channel === "sms") return linqReady();
  if (channel === "teams") return teamsConfigured();
  if (channel === "google_chat") return googleChatReady();
  return false;
}

export async function deliver(chat: Chat, members: Member[], text: string, subject: string): Promise<Sent> {
  try {
    if (chat.channel === "email") return await email(members, text, subject);
    if (chat.channel === "whatsapp") return await whatsapp(chat, text);
    if (chat.channel === "sms") {
      if (chat.linq_group_id) return await linqSend(chat.linq_group_id, text);
      // No group yet: start one with the Roster's phone numbers and keep its id on the chat.
      const started = await linqStart(members.map((m) => m.phone ?? "").filter(Boolean), text);
      if (started.ok && started.groupId) await db().from("follow_chats").update({ linq_group_id: started.groupId }).eq("id", chat.id);
      return started.ok ? { ok: true, externalId: started.externalId } : started;
    }
    if (chat.channel === "teams") return await teamsSend(chat.teams_chat_id, text);
    if (chat.channel === "google_chat") return await googleChatSend(chat.google_chat_space, text);
    return { ok: false, error: `${CHANNELS[chat.channel]} isn't connected to the Service site yet.` };
  } catch {
    return { ok: false, error: `${CHANNELS[chat.channel]} didn't answer. Try again.` };
  }
}

async function email(members: Member[], text: string, subject: string): Promise<Sent> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.FOLLOW_UP_EMAIL_FROM || process.env.INVITE_EMAIL_FROM;
  if (!key || !from) return { ok: false, error: "Email isn't set up: RESEND_API_KEY is missing." };
  const to = [...new Set(members.map((m) => m.email?.trim().toLowerCase()).filter((e): e is string => !!e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !e.endsWith(".guest.google")))];
  if (!to.length) return { ok: false, error: "No one in this chat has an email address." };
  const replyTo = process.env.FOLLOW_UP_REPLY_TO;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to, subject,
      text,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;white-space:pre-wrap">${escapeHtml(text)}</div>`,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!res.ok) return { ok: false, error: "The email didn't send. Check the Resend settings." };
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, externalId: body.id };
}

// Periskope sends to WhatsApp groups from the company's WhatsApp number.
async function whatsapp(chat: Chat, text: string): Promise<Sent> {
  const key = (process.env.PERISKOPE_API_KEY ?? process.env.PERISKOPE_API);
  const phone = process.env.PERISKOPE_PHONE;
  if (!key || !phone) return { ok: false, error: "WhatsApp isn't connected yet: PERISKOPE_API_KEY and PERISKOPE_PHONE need to be set in Vercel." };
  if (!chat.whatsapp_group_id) return { ok: false, error: "This chat has no WhatsApp group id. Add it in the chat's settings." };
  const res = await fetch("https://api.periskope.app/v1/message/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "x-phone": phone, "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat.whatsapp_group_id, message: text }),
  });
  if (!res.ok) return { ok: false, error: `WhatsApp refused the message (${res.status}).` };
  const body = (await res.json().catch(() => ({}))) as { unique_id?: string; queue_id?: string };
  return { ok: true, externalId: body.unique_id ?? body.queue_id };
}

// The follow-up layout the BDC already uses in the dealer chats.
export function followUpText(f: { customer: string; phone: string; vehicle: string | null; vin: string | null; advisor: string | null; reason: string }) {
  return [
    `Name and Last name: ${f.customer}`,
    `Phone number: ${f.phone}`,
    f.vehicle ? `Vehicle: ${f.vehicle}` : null,
    f.vin ? `VIN: ${f.vin}` : null,
    f.advisor ? `@${f.advisor}` : null,
    `Reason for a call: ${f.reason}`,
  ].filter(Boolean).join("\n");
}

// Names from the WhatsApp group itself, through Periskope. Returns phone -> name.
export async function whatsappNames(groupId: string): Promise<Map<string, string> | string> {
  const key = (process.env.PERISKOPE_API_KEY ?? process.env.PERISKOPE_API);
  const phone = process.env.PERISKOPE_PHONE;
  if (!key || !phone) return "WhatsApp isn't connected yet, so names can't be synced.";
  try {
    const res = await fetch(`https://api.periskope.app/v1/chats/${encodeURIComponent(groupId)}`, { headers: { Authorization: `Bearer ${key}`, "x-phone": phone } });
    if (!res.ok) return `WhatsApp didn't return the group (${res.status}).`;
    const body = (await res.json()) as any;
    const list: any[] = body?.members ? Object.values(body.members) : body?.chat?.members ? Object.values(body.chat.members) : [];
    const names = new Map<string, string>();
    for (const m of list) {
      const num = String(m?.contact_id ?? m?.id ?? "").replace(/@.*$/, "").replace(/\D/g, "");
      const name = String(m?.contact_name ?? m?.name ?? m?.pushname ?? "").trim();
      if (num && name) names.set(num.slice(-10), name);
    }
    return names;
  } catch {
    return "WhatsApp didn't answer. Try again.";
  }
}
