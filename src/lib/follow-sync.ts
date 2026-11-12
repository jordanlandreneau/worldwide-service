import "server-only";
import { db } from "@/lib/data";
import { saveInbound } from "@/lib/follow-inbound";
import { googleMessages, googlePull, googleSpaceMembers, googleSpaces, type Pulled, teamsPull } from "@/lib/follow-providers";
import { smsPull } from "@/lib/follow-sms";
import { storeRemote } from "@/lib/follow-media";

// Saves only the messages this chat doesn't have yet (one lookup per chat), and returns how many were new.
async function saveNew(chatId: string, list: Pulled[]) {
  const ids = list.map((m) => m.externalId).filter(Boolean);
  if (!ids.length) return 0;
  const { data } = await db().from("follow_messages").select("external_id").eq("chat_id", chatId).in("external_id", ids);
  const have = new Set(((data ?? []) as any[]).map((r) => r.external_id));
  const fresh = list.filter((m) => !have.has(m.externalId));
  // Pictures are copied into the site's storage as the message comes in (chat-app links expire).
  const files = new Map<string, unknown[]>();
  for (const m of fresh) if (m.media?.length) files.set(m.externalId, (await Promise.all(m.media.slice(0, 6).map((x) => storeRemote(chatId, x)))).filter(Boolean));
  const ours = fresh.filter((m) => m.ours);
  if (ours.length) {
    // Our team's messages (sent in the chat app itself) are kept as our side of the conversation.
    await db().from("follow_messages").upsert(ours.map((m) => ({
      chat_id: chatId, direction: "outbound", body: m.body.slice(0, 8000), sender: m.sender, sender_name: m.senderName, status: "sent", attachments: files.get(m.externalId) ?? [],
      external_id: m.externalId, read: true, created_at: new Date(m.at).toISOString(),
    })), { onConflict: "chat_id,external_id", ignoreDuplicates: true });
  }
  for (const m of fresh.filter((x) => !x.ours)) await saveInbound(chatId, { body: m.body, sender: m.sender, senderName: m.senderName, externalId: m.externalId, at: m.at, attachments: files.get(m.externalId) ?? [] });
  return fresh.length;
}

// Claims a sync slot so many open browsers don't all pull at once. Returns the previous run time, or null if too soon.
async function claim(name: string, everyMs: number) {
  const client = db();
  const { data: last } = await client.from("follow_integrations").select("updated_at").eq("name", name).maybeSingle();
  if (last?.updated_at && Date.now() - new Date(last.updated_at).getTime() < everyMs) return null;
  await client.from("follow_integrations").upsert({ name, data: {}, updated_at: new Date().toISOString() });
  return last?.updated_at ? new Date(last.updated_at).getTime() : 0;
}

// Teams replies are pulled (Teams push needs a subscription renewed every hour).
export async function pullTeams(force = false) {
  const prev = await claim("teams_sync", force ? 0 : 20_000);
  if (prev === null) return 0;
  const { data: chats } = await db().from("follow_chats").select("id,teams_chat_id").eq("channel", "teams").eq("active", true).not("teams_chat_id", "is", null);
  return teamsPull((chats ?? []) as any[], saveNew);
}

// WhatsApp replies are also pulled from Periskope, so nothing is missed if a webhook is late or not pointed here yet.
export async function pullWhatsApp(force = false) {
  const key = process.env.PERISKOPE_API_KEY ?? process.env.PERISKOPE_API;
  const phone = process.env.PERISKOPE_PHONE;
  if (!key || !phone) return 0;
  const prev = await claim("whatsapp_sync", force ? 0 : 20_000);
  if (prev === null) return 0;
  const since = new Date(prev ? Math.min(Date.now() - 10 * 60_000, prev - 5 * 60_000) : Date.now() - 3 * 86400_000).toISOString();
  const { data: chats } = await db().from("follow_chats").select("id,whatsapp_group_id").eq("channel", "whatsapp").eq("active", true).not("whatsapp_group_id", "is", null);
  const counts = await Promise.all(((chats ?? []) as any[]).map(async (c) => {
    try {
      const res = await fetch(`https://api.periskope.app/v1/chats/${encodeURIComponent(c.whatsapp_group_id)}/messages?limit=100&start_time=${encodeURIComponent(since)}`, { headers: { Authorization: `Bearer ${key}`, "x-phone": phone } });
      if (!res.ok) return 0;
      const list = (((await res.json()) as any).messages ?? []) as any[];
      const mediaOf = (m: any) => {
        const md = m.media ?? {};
        let url = String(md.path ?? md.url ?? m.media_url ?? "");
        if (url && url.startsWith("/")) url = `https://api.periskope.app${url}`;
        const type = String(md.mimetype ?? md.mime_type ?? "");
        return m.has_media !== false && /^https:\/\//.test(url) ? [{ url, type: type || undefined, name: md.filename ?? undefined, auth: url.includes("periskope.app") ? `Bearer ${key}` : undefined }] : [];
      };
      return await saveNew(c.id, list.reverse()
        .filter((m) => !m.from_me && ((typeof m.body === "string" && m.body.trim()) || mediaOf(m).length))
        .map((m) => ({ body: String(m.body ?? "").trim(), sender: String(m.sender_phone ?? m.author ?? "").replace(/@.*$/, "") || null, senderName: null, externalId: m.message_id ?? m.unique_id, at: m.timestamp, media: mediaOf(m) })));
    } catch { return 0; }
  }));
  return counts.reduce((a, b) => a + b, 0);
}

// Text replies: incoming JustCall texts on each chat's line from a Roster phone.
export async function pullSms(force = false) {
  const prev = await claim("sms_sync", force ? 0 : 20_000);
  if (prev === null) return 0;
  const since = prev ? Math.min(Date.now() - 10 * 60_000, prev - 5 * 60_000) : Date.now() - 2 * 86400_000;
  return smsPull(saveNew as any, since);
}

// Google Chat messages, read as the signed-in BDC Google account.
export async function pullGoogle(force = false) {
  const prev = await claim("google_sync", force ? 0 : 20_000);
  if (prev === null) return 0;
  const since = new Date(prev ? Math.min(Date.now() - 10 * 60_000, prev - 5 * 60_000) : Date.now() - 2 * 86400_000);
  // Every 5 minutes, also pick up spaces created or joined since the last look (new stores being onboarded),
  // and bring over the history and Roster of any Google Chat chat that hasn't had that yet.
  if ((await claim("google_spaces", 5 * 60_000)) !== null) {
    await importGoogleSpaces("google-sync").catch(() => 0);
    const { data: all } = await db().from("follow_chats").select("id,google_chat_space").eq("channel", "google_chat").not("google_chat_space", "is", null);
    const { data: done } = await db().from("follow_integrations").select("name").like("name", "gbackfill:%");
    const did = new Set(((done ?? []) as any[]).map((r) => r.name));
    for (const c of ((all ?? []) as any[]).filter((c) => !did.has(`gbackfill:${c.id}`)).slice(0, 10)) await backfillGoogleChat(c.id).catch(() => null);
  }
  const { data: chats } = await db().from("follow_chats").select("id,google_chat_space").eq("channel", "google_chat").eq("active", true).not("google_chat_space", "is", null);
  return googlePull((chats ?? []) as any[], since, saveNew);
}

// "Andy Mohr Honda // WWBDC Follow Up's" → "andy mohr honda": the part that names the store.
const storeWords = (v: string) => v.toLowerCase().split(/\/\/|\||\s-\s/)[0].replace(/\(.*?\)/g, " ").replace(/\b(wwbdc|worldwide|bdc|follow ?ups?'?s?|service|chat|new)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

// Adds a Follow-ups chat for every Google Chat space the signed-in account is in that isn't here yet.
export async function importGoogleSpaces(by: string) {
  const spaces = await googleSpaces();
  if (!spaces.length) return 0;
  const client = db();
  const { data: have } = await client.from("follow_chats").select("google_chat_space").not("google_chat_space", "is", null);
  const known = new Set(((have ?? []) as any[]).map((c) => c.google_chat_space));
  const fresh = spaces.filter((sp) => !known.has(sp.name));
  if (!fresh.length) return 0;
  // Link the store when exactly one active store matches the space's name.
  const { data: stores } = await client.from("dealerships").select("id,name,active");
  const active = ((stores ?? []) as any[]).filter((x) => x.active !== false).map((x) => ({ id: x.id as string, key: storeWords(x.name) })).filter((x) => x.key.length >= 4);
  const storeFor = (name: string) => {
    const k = storeWords(name);
    if (k.length < 4) return null;
    const hits = active.filter((x) => x.key === k);
    const loose = hits.length ? hits : active.filter((x) => k.includes(x.key) || x.key.includes(k));
    return loose.length === 1 ? loose[0].id : null;
  };
  const { error } = await client.from("follow_chats").insert(fresh.map((sp) => ({ name: sp.displayName.slice(0, 200), channel: "google_chat", google_chat_space: sp.name, dealership_id: storeFor(sp.displayName), active: true, created_by: by })));
  if (error) return 0;
  // A popup for managers and admins, so a new store's space doesn't go unnoticed.
  await client.from("site_events").insert(fresh.map((sp) => ({ kind: "onboarding", dealership_id: storeFor(sp.displayName), title: `New Google Chat added: ${sp.displayName.slice(0, 120)}`, body: storeFor(sp.displayName) ? "Linked to its store automatically." : "Open its Settings to pick the store.", link: "/follow-up?channel=google_chat", created_by: by })));
  return fresh.length;
}

export async function pullAll() {
  const [teams, whatsapp, sms, google] = await Promise.all([pullTeams().catch(() => 0), pullWhatsApp().catch(() => 0), pullSms().catch(() => 0), pullGoogle().catch(() => 0)]);
  return teams + whatsapp + sms + google;
}

// The last 30 days of messages and the space's members, for a Google Chat chat. Safe to run again.
export async function backfillGoogleChat(chatId: string) {
  const client = db();
  const { data: chat } = await client.from("follow_chats").select("id,google_chat_space").eq("id", chatId).maybeSingle();
  if (!chat?.google_chat_space) return { messages: 0, people: 0 };
  const msgs = await googleMessages(chat.google_chat_space, new Date(Date.now() - 30 * 86400_000), 5);
  const messages = await saveNew(chatId, msgs);
  // History isn't new work: older store messages count as already seen.
  await client.from("follow_messages").update({ read: true }).eq("chat_id", chatId).eq("direction", "inbound").lt("created_at", new Date(Date.now() - 86400_000).toISOString());
  const members = await googleSpaceMembers(chat.google_chat_space);
  const { data: have } = await client.from("follow_members").select("email,name").eq("chat_id", chatId);
  const known = new Set(((have ?? []) as any[]).map((m) => String(m.email ?? "").toLowerCase()).filter(Boolean));
  const add = members.filter((m) => m.email && !known.has(m.email));
  if (add.length) await client.from("follow_members").insert(add.map((m) => ({ chat_id: chatId, name: (m.name ?? m.email!.split("@")[0]).slice(0, 120), email: m.email, role: "member" })));
  await client.from("follow_integrations").upsert({ name: `gbackfill:${chatId}`, data: { messages, people: add.length, unknown: members.filter((m) => !m.email).length }, updated_at: new Date().toISOString() });
  return { messages, people: add.length, unknown: members.filter((m) => !m.email).length };
}
