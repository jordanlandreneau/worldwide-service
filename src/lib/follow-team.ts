import "server-only";
import { db } from "@/lib/data";

// Who in a dealer chat is our own team. Messages our agents type straight into WhatsApp, Teams,
// Google Chat, Slack or a group text are our side of the conversation, not store messages to answer.

export const normName = (s?: string | null) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

type Person = { email: string; first: string; full: string; short: string };
let cache: { at: number; people: Person[] } | null = null;

export async function teamPeople(): Promise<Person[]> {
  if (cache && Date.now() - cache.at < 300_000) return cache.people;
  const { data } = await db().from("app_users").select("email,first_name,last_name,status").limit(2000);
  const people = ((data ?? []) as any[]).filter((u) => u.status !== "disabled").map((u) => {
    const first = normName(u.first_name);
    const last = normName(u.last_name);
    return { email: String(u.email).toLowerCase(), first, full: `${first} ${last}`.trim(), short: `${first} ${last.split(" ")[0] ?? ""}`.trim() };
  });
  cache = { at: Date.now(), people };
  return people;
}

export async function isTeam(sender: string | null | undefined, senderName: string | null | undefined) {
  if (/@worldwidebdc\.com$/i.test(String(sender ?? "").trim())) return true;
  if (/wwbdc|worldwide/i.test(senderName ?? "")) return true;
  const n = normName(senderName);
  if (!n.includes(" ")) return false;
  return (await teamPeople()).some((p) => p.full === n || p.short === n);
}

// Once our team speaks in a chat, the store messages still waiting from the 24 hours before count as answered by that person.
export async function answerEarlier(chatId: string, at: string, by: { name: string | null; email: string | null }) {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return;
  await db().from("follow_messages").update({ handled_kind: "answered", handled_by: by.email, handled_name: by.name ?? "WWBDC", handled_at: when.toISOString(), read: true })
    .eq("chat_id", chatId).eq("direction", "inbound").is("handled_kind", null)
    .lt("created_at", when.toISOString()).gt("created_at", new Date(when.getTime() - 86400_000).toISOString());
}
