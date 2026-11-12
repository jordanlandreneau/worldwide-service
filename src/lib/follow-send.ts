import "server-only";
import { escapeHtml } from "@/lib/mail";
import { googleChatReady, googleChatSend, googleUserConfigured, teamsConfigured, teamsSend } from "@/lib/follow-providers";
import { smsSend } from "@/lib/follow-sms";
import { type Attachment, type Mention, readBytes, shareLink } from "@/lib/follow-media";

// Delivers a message to a dealership chat on its own channel.
// Each channel turns on when its keys are set in Vercel; until then it says what's missing.

export type Chat = {
  id: string; name: string; channel: "whatsapp" | "teams" | "email" | "google_chat" | "sms" | "slack";
  whatsapp_group_id: string | null; teams_chat_id: string | null; google_chat_space: string | null; dealership_id?: string | null; justcall_line?: string | null; justcall_group_id?: string | null; slack_channel_id?: string | null;
};
export type Member = { name: string; phone: string | null; email: string | null };
export type Sent = { ok: true; externalId?: string } | { ok: false; error: string };

export { CHANNEL_NAMES as CHANNELS } from "@/lib/follow-channels";
import { CHANNEL_NAMES as CHANNELS } from "@/lib/follow-channels";

export function channelReady(channel: Chat["channel"]) {
  if (channel === "email") return !!(process.env.RESEND_API_KEY && (process.env.FOLLOW_UP_EMAIL_FROM || process.env.INVITE_EMAIL_FROM));
  if (channel === "whatsapp") return !!((process.env.PERISKOPE_API_KEY ?? process.env.PERISKOPE_API) && process.env.PERISKOPE_PHONE);
  if (channel === "sms") return !!process.env.JUSTCALL_API_KEY && !!process.env.JUSTCALL_API_SECRET;
  if (channel === "teams") return teamsConfigured();
  if (channel === "google_chat") return googleUserConfigured() || googleChatReady();
  return false;
}

export type Extras = { attachments?: Attachment[]; mentions?: Mention[] };

export async function deliver(chat: Chat, members: Member[], text: string, subject: string, senderEmail?: string, extras: Extras = {}): Promise<Sent> {
  try {
    const files = extras.attachments ?? [];
    // Teams and Google Chat take the picture itself; WhatsApp and texts fetch it from a 7-day link.
    const bytes = async () => (await Promise.all(files.map(async (a) => { const f = await readBytes(a.path); return f ? { bytes: f.bytes, type: a.type, name: a.name } : null; }))).filter(Boolean) as { bytes: ArrayBuffer; type: string; name: string }[];
    const links = async () => (await Promise.all(files.map(async (a) => ({ ...a, url: await shareLink(a.path) })))).filter((a) => a.url) as (Attachment & { url: string })[];
    if (chat.channel === "email") return await email(members, text + ((await links()).map((a) => `\n${a.name}: ${a.url}`).join("")), subject);
    if (chat.channel === "whatsapp") return await whatsapp(chat, text, await links(), extras.mentions ?? [], members);
    if (chat.channel === "sms") {
      // Through JustCall, from the dealership's Service line, as one group text.
      const r = await smsSend(chat, members.map((m) => m.phone ?? ""), text, (await links()).map((a) => a.url));
      return r.ok ? { ok: true, externalId: r.externalId } : r;
    }
    if (chat.channel === "teams") return await teamsSend(chat.teams_chat_id, text, { pictures: await bytes(), mentions: extras.mentions });
    if (chat.channel === "google_chat") return await googleChatSend(chat.google_chat_space, text, senderEmail, { pictures: await bytes(), mentions: extras.mentions });
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
async function whatsapp(chat: Chat, text: string, pictures: (Attachment & { url: string })[] = [], mentions: Mention[] = [], members: Member[] = []): Promise<Sent> {
  const key = (process.env.PERISKOPE_API_KEY ?? process.env.PERISKOPE_API);
  const phone = process.env.PERISKOPE_PHONE;
  if (!key || !phone) return { ok: false, error: "WhatsApp isn't connected yet: PERISKOPE_API_KEY and PERISKOPE_PHONE need to be set in Vercel." };
  if (!chat.whatsapp_group_id) return { ok: false, error: "This chat has no WhatsApp group id. Add it in the chat's settings." };
  // WhatsApp tags a person when the text has @ and their phone number.
  let message = text;
  for (const m of mentions) {
    const ph = (m.phone ?? members.find((x) => x.name.toLowerCase() === m.name.toLowerCase())?.phone ?? "").replace(/\D/g, "");
    if (ph.length >= 10) message = message.replace(`@${m.name}`, `@${ph.length === 10 ? `1${ph}` : ph}`);
  }
  const send = (payload: Record<string, unknown>) => fetch("https://api.periskope.app/v1/message/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "x-phone": phone, "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat.whatsapp_group_id, ...payload }),
  });
  // One picture per WhatsApp message: the first carries the text as its caption.
  const media = (p: Attachment & { url: string }) => ({ type: p.type.startsWith("image/") ? "image" : "document", url: p.url, filename: p.name, mimetype: p.type });
  const res = await send(pictures.length ? { message, media: media(pictures[0]) } : { message });
  if (!res.ok) return { ok: false, error: `WhatsApp refused the message (${res.status}).` };
  for (const p of pictures.slice(1)) await send({ media: media(p) });
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
