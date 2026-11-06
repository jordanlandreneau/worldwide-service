import "server-only";
import { db } from "@/lib/data";
import { saveInbound } from "@/lib/follow-inbound";
import { teamsPull } from "@/lib/follow-providers";

// Teams has no push without a public subscription to renew hourly, so replies are pulled:
// when someone opens Follow-ups (at most every 2 minutes) or when a scheduler calls /api/public/teams-sync.
export async function pullTeams(force = false) {
  const client = db();
  const { data: last } = await client.from("follow_integrations").select("updated_at").eq("name", "teams_sync").maybeSingle();
  if (!force && last?.updated_at && Date.now() - new Date(last.updated_at).getTime() < 120_000) return 0;
  await client.from("follow_integrations").upsert({ name: "teams_sync", data: {}, updated_at: new Date().toISOString() });
  const { data: chats } = await client.from("follow_chats").select("id,teams_chat_id").eq("channel", "teams").eq("active", true).not("teams_chat_id", "is", null);
  return teamsPull((chats ?? []) as any[], async (chatId, m) => saveInbound(chatId, { body: m.body, sender: m.sender, senderName: m.senderName, externalId: m.externalId, at: m.at }));
}

// WhatsApp replies are also pulled from Periskope, so they show up even before the webhook points here
// (and if a webhook is ever missed). At most once a minute, from shortly before the last pull.
export async function pullWhatsApp(force = false) {
  const key = process.env.PERISKOPE_API_KEY ?? process.env.PERISKOPE_API;
  const phone = process.env.PERISKOPE_PHONE;
  if (!key || !phone) return 0;
  const client = db();
  const { data: last } = await client.from("follow_integrations").select("updated_at,data").eq("name", "whatsapp_sync").maybeSingle();
  if (!force && last?.updated_at && Date.now() - new Date(last.updated_at).getTime() < 60_000) return 0;
  const since = new Date(Math.min(Date.now() - 10 * 60_000, last?.updated_at ? new Date(last.updated_at).getTime() - 5 * 60_000 : Date.now() - 3 * 86400_000)).toISOString();
  await client.from("follow_integrations").upsert({ name: "whatsapp_sync", data: {}, updated_at: new Date().toISOString() });
  const { data: chats } = await client.from("follow_chats").select("id,whatsapp_group_id").eq("channel", "whatsapp").eq("active", true).not("whatsapp_group_id", "is", null);
  let saved = 0;
  await Promise.all(((chats ?? []) as any[]).map(async (c) => {
    try {
      const res = await fetch(`https://api.periskope.app/v1/chats/${encodeURIComponent(c.whatsapp_group_id)}/messages?limit=100&start_time=${encodeURIComponent(since)}`, { headers: { Authorization: `Bearer ${key}`, "x-phone": phone } });
      if (!res.ok) return;
      const list = (((await res.json()) as any).messages ?? []) as any[];
      for (const m of list.reverse()) {
        if (m.from_me || typeof m.body !== "string" || !m.body.trim()) continue;
        await saveInbound(c.id, { body: m.body, sender: String(m.sender_phone ?? m.author ?? "").replace(/@.*$/, "") || null, externalId: m.message_id ?? m.unique_id ?? null, at: m.timestamp ?? null });
        saved++;
      }
    } catch { /* try again next pull */ }
  }));
  return saved;
}
