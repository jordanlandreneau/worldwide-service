import "server-only";
import { db } from "@/lib/data";
import { saveInbound } from "@/lib/follow-inbound";
import { type Pulled, teamsPull } from "@/lib/follow-providers";

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

export async function pullAll() {
  const [teams, whatsapp] = await Promise.all([pullTeams().catch(() => 0), pullWhatsApp().catch(() => 0)]);
  return teams + whatsapp;
}
