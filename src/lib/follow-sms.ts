import "server-only";
import { db } from "@/lib/data";
import { e164, justcall, lineKey } from "@/lib/justcall";

// Text follow-ups go through JustCall, from the dealership's JustCall number, to each phone in the chat's Roster.
// Replies come back the same way: incoming texts on that line from a Roster phone land in the chat.

type SmsChat = { id: string; dealership_id?: string | null; justcall_line?: string | null };

// The line a chat texts from: the store profile's "JustCall number (Service line)", unless the chat names its own.
export async function smsLine(chat: SmsChat): Promise<string | null> {
  if (lineKey(chat.justcall_line).length === 10) return lineKey(chat.justcall_line);
  if (!chat.dealership_id) return null;
  const client = db();
  const { data: dept } = await client.from("departments").select("id").ilike("name", "service").maybeSingle();
  if (!dept?.id) return null;
  const { data: link } = await client.from("dealership_departments").select("just_call_number").eq("dealership_id", chat.dealership_id).eq("department_id", dept.id).maybeSingle();
  return lineKey(link?.just_call_number).length === 10 ? lineKey(link!.just_call_number) : null;
}

const MAX_MEMBERS = 9; // JustCall group texts: the line plus up to 9 people.
const fmt = (p: string) => `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`;

// One group text per chat, like a group thread on a phone. The first send creates the JustCall group
// (with the Roster's phones) and sends the message into it; later sends go into the same group.
export async function smsSend(chat: SmsChat & { name?: string; justcall_group_id?: string | null }, phones: string[], text: string, mediaUrls: string[] = []) {
  if (!process.env.JUSTCALL_API_KEY || !process.env.JUSTCALL_API_SECRET) return { ok: false as const, error: "JustCall isn't connected: JUSTCALL_API_KEY is missing." };
  const line = await smsLine(chat);
  if (!line) return { ok: false as const, error: "This chat's store has no Service line. Add the JustCall number (Service line) on the store profile, then send again." };
  if (text.length > 1600) return { ok: false as const, error: "Texts can be at most 1,600 characters." };
  const from = e164(line);
  if (chat.justcall_group_id) {
    let res = await justcall(`/texts/groups/${encodeURIComponent(chat.justcall_group_id)}/messages`, { method: "POST", body: JSON.stringify({ justcall_number: from, body: text || " ", ...(mediaUrls.length ? { media_url: mediaUrls.join(",") } : {}) }) });
    // If JustCall won't take the picture, send the text with a link to it instead.
    if (!res.ok && res.status === 400 && mediaUrls.length) res = await justcall(`/texts/groups/${encodeURIComponent(chat.justcall_group_id)}/messages`, { method: "POST", body: JSON.stringify({ justcall_number: from, body: `${text}\n${mediaUrls.join("\n")}`.trim() }) });
    const json = (await res.json().catch(() => ({}))) as any;
    if (res.ok) return { ok: true as const, externalId: String(json?.data?.id ?? json?.id ?? "") || undefined };
    if (res.status !== 404) return { ok: false as const, error: `JustCall didn't send it (${res.status}${json?.message ? `: ${json.message}` : ""}).` };
    // The group was deleted in JustCall: start a new one below.
  }
  const to = [...new Set(phones.map((p) => lineKey(p)).filter((p) => p.length === 10 && p !== line))];
  if (!to.length) return { ok: false as const, error: "Add the store people's mobile numbers in the Roster, then send again." };
  if (to.length > MAX_MEMBERS) return { ok: false as const, error: `A JustCall group text can include up to ${MAX_MEMBERS} people. This Roster has ${to.length} phone numbers; remove some (or clear their phone) and send again.` };
  const res = await justcall("/texts/groups", { method: "POST", body: JSON.stringify({
    group_name: (chat.name ?? "Service follow-up").slice(0, 100), justcall_number: from, body: text || " ", ...(mediaUrls.length ? { media_url: mediaUrls.join(",") } : {}),
    members: to.map((p) => ({ type: "contact", phone_number: e164(p) })),
  }) });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) return { ok: false as const, error: `JustCall couldn't start the group text (${res.status}${json?.message ? `: ${json.message}` : ""}).` };
  const groupId = String(json?.data?.group_id ?? json?.data?.id ?? json?.group_id ?? json?.id ?? "");
  if (groupId) await db().from("follow_chats").update({ justcall_group_id: groupId }).eq("id", chat.id);
  return { ok: true as const, externalId: String(json?.data?.message_id ?? json?.data?.message?.id ?? "") || undefined, note: groupId ? undefined : `Group started for ${to.map(fmt).join(", ")}` };
}

// Replies in each chat's JustCall group: messages that didn't come from our line.
export async function smsPull(saveNew: (chatId: string, list: { body: string; sender: string | null; senderName: string | null; externalId: string; at: string; media?: { url: string }[] }[]) => Promise<number>, sinceMs: number) {
  if (!process.env.JUSTCALL_API_KEY || !process.env.JUSTCALL_API_SECRET) return 0;
  const client = db();
  const { data: chats } = await client.from("follow_chats").select("id,dealership_id,justcall_line,justcall_group_id").eq("channel", "sms").eq("active", true).not("justcall_group_id", "is", null);
  const list = (chats ?? []) as (SmsChat & { justcall_group_id: string })[];
  if (!list.length) return 0;
  const { data: members } = await client.from("follow_members").select("chat_id,phone,name").in("chat_id", list.map((c) => c.id));
  let added = 0;
  for (const c of list) {
    const line = await smsLine(c);
    if (!line) continue;
    try {
      const q = new URLSearchParams({ justcall_number: e164(line), per_page: "50", order: "desc" });
      const res = await justcall(`/texts/groups/${encodeURIComponent(c.justcall_group_id)}/messages?${q}`, undefined, 0);
      if (!res.ok) continue;
      const msgs = (((await res.json()) as any)?.data ?? []) as any[];
      const names = new Map(((members ?? []) as any[]).filter((m) => m.chat_id === c.id).map((m) => [lineKey(m.phone), m.name as string]));
      const items = msgs.reverse().map((m) => {
        const sender = lineKey(m.contact_number ?? m.sender_number ?? m.from ?? m.phone_number ?? m.sender?.phone_number ?? "");
        const direction = String(m.direction ?? m.sms_info?.direction ?? m.message_direction ?? "");
        const body = String(m.body ?? m.sms_info?.body ?? m.message ?? "").trim();
        const at = m.sms_date ? `${m.sms_date}T${m.sms_time ?? "00:00:00"}Z` : String(m.created_at ?? m.datetime ?? new Date().toISOString());
        // Picture texts: any https link JustCall gives for the message's media.
        const raw = [m.media_url, m.mms_url, m.media, m.attachments, m.sms_info?.media_url, m.sms_info?.mms].flat().filter(Boolean);
        const media = raw.flatMap((x: any) => String(typeof x === "object" ? x.url ?? x.media_url ?? "" : x).split(",")).map((u: string) => u.trim()).filter((u: string) => /^https:\/\//.test(u)).map((url: string) => ({ url }));
        return { sender, direction, body, at, id: m.id, media };
      }).filter((m) => (m.body || m.media.length) && m.id && !/out/i.test(m.direction) && m.sender !== line && Date.parse(m.at) >= sinceMs - 60_000)
        .map((m) => ({ body: m.body, sender: m.sender || null, senderName: names.get(m.sender) ?? null, externalId: `jcg-${m.id}`, at: m.at, media: m.media }));
      if (items.length) added += await saveNew(c.id, items);
    } catch { /* next pull */ }
  }
  return added;
}
