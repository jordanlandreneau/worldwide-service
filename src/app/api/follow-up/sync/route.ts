import { NextResponse, type NextRequest } from "next/server";
import { atLeast, getUser } from "@/lib/access";
import { db } from "@/lib/data";
import { pullAll } from "@/lib/follow-sync";

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
  const { data } = await client.from("follow_messages").select("id,chat_id,body,sender_name,sender,received_at")
    .eq("direction", "inbound").gt("received_at", since).order("received_at").limit(10);
  const rows = (data ?? []) as any[];
  const ids = [...new Set(rows.map((r) => r.chat_id))];
  const { data: chats } = ids.length ? await client.from("follow_chats").select("id,name,channel").in("id", ids) : { data: [] };
  const chat = new Map(((chats ?? []) as any[]).map((c) => [c.id, c]));
  return NextResponse.json({
    added: added || rows.length, now: rows.at(-1)?.received_at ?? now,
    messages: rows.map((r) => ({ id: r.id, chatId: r.chat_id, chat: chat.get(r.chat_id)?.name ?? "Chat", channel: chat.get(r.chat_id)?.channel ?? "", from: r.sender_name || r.sender || "Store", body: String(r.body).slice(0, 300) })),
  });
}
