import "server-only";
import { db } from "@/lib/data";
import { saveInbound } from "@/lib/follow-inbound";
import { googlePull, googleSpaces, type Pulled, teamsPull } from "@/lib/follow-providers";
import { smsPull } from "@/lib/follow-sms";

// Saves only the messages this chat doesn't have yet (one lookup per chat), and returns how many were new.
async function saveNew(chatId: string, list: Pulled[]) {
  const ids = list.map((m) => m.externalId).filter(Boolean);
  if (!ids.length) return 0;
  const { data } = await db().from("follow_messages").select("external_id").eq("chat_id", chatId).in("external_id", ids);
  const have = new Set(((data ?? []) as any[]).map((r) => r.external_id));
  const fresh = list.filter((m) => !have.has(m.externalId));
  for (const m of fresh) await saveInbound(chatId, { body: m.body, sender: m.sender, senderName: m.senderName, externalId: m.externalId, at: m.at });
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
      return await saveNew(c.id, list.reverse()
        .filter((m) => !m.from_me && typeof m.body === "string" && m.body.trim())
        .map((m) => ({ body: m.body, sender: String(m.sender_phone ?? m.author ?? "").replace(/@.*$/, "") || null, senderName: null, externalId: m.message_id ?? m.unique_id, at: m.timestamp })));
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
  // Every 5 minutes, also pick up spaces created or joined since the last look (new stores being onboarded).
  if ((await claim("google_spaces", 5 * 60_000)) !== null) await importGoogleSpaces("google-sync").catch(() => 0);
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
