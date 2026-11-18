import "server-only";
import { db } from "@/lib/data";
import { teamPeople } from "@/lib/follow-team";

// Personal notifications: a store message belongs to the agents who sent something in that chat from
// the site in the 72 hours before it (their follow-up is what the store is answering), plus anyone
// @-mentioned by name. Nobody else gets a popup for it unless they chose to see more.

const WINDOW = 72 * 3600_000;
export type Alerts = "mine" | "unclaimed" | "all";
export const alertsFor = (role: string, saved?: string | null): Alerts =>
  saved === "mine" || saved === "unclaimed" || saved === "all" ? saved : role === "agent" ? "mine" : "unclaimed";

export type StoreMsg = { id: string; chat_id: string; body: string; created_at: string };
export type Claim = { owners: Set<string>; mentioned: Set<string>; followUp: string | null; followUpBy: string | null };

export async function claims(rows: StoreMsg[]): Promise<Map<string, Claim>> {
  const out = new Map<string, Claim>();
  if (!rows.length) return out;
  const chats = [...new Set(rows.map((r) => r.chat_id))];
  const oldest = Math.min(...rows.map((r) => Date.parse(r.created_at))) - WINDOW;
  const [{ data: sent }, people] = await Promise.all([
    db().from("follow_messages").select("chat_id,created_by,created_at,kind,customer_name,sender_name").eq("direction", "outbound").not("created_by", "is", null)
      .in("chat_id", chats).gte("created_at", new Date(oldest).toISOString()).order("created_at", { ascending: false }).limit(5000),
    teamPeople(),
  ]);
  const byChat = new Map<string, any[]>();
  for (const s of (sent ?? []) as any[]) byChat.set(s.chat_id, [...(byChat.get(s.chat_id) ?? []), s]);
  for (const r of rows) {
    const at = Date.parse(r.created_at);
    const before = (byChat.get(r.chat_id) ?? []).filter((s) => { const t = Date.parse(s.created_at); return t < at && t >= at - WINDOW; });
    const owners = new Set<string>(before.map((s) => String(s.created_by).toLowerCase()));
    const text = ` ${String(r.body ?? "").toLowerCase()} `;
    const mentioned = new Set<string>(people.filter((p) => (p.first.length >= 3 && text.includes(`@${p.first}`)) || (p.full.includes(" ") && text.includes(`@${p.full}`))).map((p) => p.email));
    out.set(r.id, { owners, mentioned, followUp: before.find((s) => s.kind === "follow_up")?.customer_name ?? null, followUpBy: before.find((s) => s.kind === "follow_up")?.sender_name ?? before[0]?.sender_name ?? null });
  }
  return out;
}

export const isMine = (c: Claim | undefined, email: string) => !!c && (c.owners.has(email.toLowerCase()) || c.mentioned.has(email.toLowerCase()));
export const unclaimed = (c: Claim | undefined) => !c || (!c.owners.size && !c.mentioned.size);

// Store messages from the last 14 days that are for this person: waiting ones and recently handled ones.
export async function myNotifications(email: string, opts: { unclaimedToo?: boolean } = {}) {
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const { data } = await db().from("follow_messages").select("id,chat_id,body,sender,sender_name,created_at,handled_kind,handled_name,handled_at,attachments")
    .eq("direction", "inbound").gte("created_at", since).order("created_at", { ascending: false }).limit(3000);
  const rows = (data ?? []) as any[];
  const c = await claims(rows);
  const mine = rows.filter((r) => isMine(c.get(r.id), email));
  const loose = opts.unclaimedToo ? rows.filter((r) => unclaimed(c.get(r.id)) && !r.handled_kind) : [];
  return { mine, loose, claims: c };
}
