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
