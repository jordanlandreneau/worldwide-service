import { NextResponse, type NextRequest } from "next/server";
import { atLeast, getUser } from "@/lib/access";
import { db } from "@/lib/data";
import { pullAll } from "@/lib/follow-sync";
import { storesForUser } from "@/lib/assignments";

// Called in the background on every page for agents and up: pulls new replies, then returns
// the store messages that reached the site since the browser last asked (for popups).
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user || user.role === "dealership" || !atLeast(user.role, "agent")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { since?: string };
  const added = await pullAll();
  const now = new Date().toISOString();
  const since = body.since && !Number.isNaN(Date.parse(body.since)) ? body.since : null;
  if (!since) return NextResponse.json({ added, now, messages: [] });
  const client = db();
  const { data } = await client.from("follow_messages").select("id,chat_id,body,sender_name,sender,received_at,created_at")
    .eq("direction", "inbound").gt("received_at", since).order("received_at").limit(10);
  const rows = (data ?? []) as any[];
  const ids = [...new Set(rows.map((r) => r.chat_id))];
  const { data: chats } = ids.length ? await client.from("follow_chats").select("id,name,channel").in("id", ids) : { data: [] };
  const chat = new Map(((chats ?? []) as any[]).map((c) => [c.id, c]));
  const until = rows.length === 10 ? rows.at(-1)!.received_at : now;
  // Site events (a store uploaded a calling sheet, work assigned to you) in the same window.
  const { data: ev } = await client.from("site_events").select("id,kind,dealership_id,user_id,title,body,link,created_by,created_at")
    .gt("created_at", since).lte("created_at", until).order("created_at").limit(20);
  let events = ((ev ?? []) as any[]).filter((e) => (e.user_id ? e.user_id === user.id : true) && String(e.created_by ?? "").toLowerCase() !== user.email.toLowerCase());
  if (!atLeast(user.role, "manager") && events.some((e) => !e.user_id)) {
    const mine = user.id ? await storesForUser(user.id) : new Set<string>();
    events = events.filter((e) => e.user_id || (e.dealership_id && mine.has(e.dealership_id)));
  }
  return NextResponse.json({
    added: added || rows.length, now: until,
    messages: [
      // Only messages sent in the last 2 hours pop up (history brought in from a chat app stays quiet).
      ...rows.filter((r) => Date.parse(r.created_at) > Date.now() - 2 * 3600_000).map((r) => ({ id: r.id, at: r.created_at, chatId: r.chat_id, chat: chat.get(r.chat_id)?.name ?? "Chat", channel: chat.get(r.chat_id)?.channel ?? "", from: r.sender_name || r.sender || "Store", body: String(r.body).slice(0, 300) })),
      ...events.map((e) => ({ id: e.id, at: e.created_at, chatId: "", chat: e.title, channel: "event", from: e.kind === "assigned" ? "Assigned to you" : e.kind === "onboarding" ? "Onboarding form" : "Calling sheet", body: String(e.body ?? "").slice(0, 300), href: e.link || "/command" })),
    ],
  });
}
