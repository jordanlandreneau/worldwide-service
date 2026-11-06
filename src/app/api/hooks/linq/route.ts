import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/data";
import { checkHookKey, saveInbound } from "@/lib/follow-inbound";

// Linq posts text-group messages here (event message.received).
// Set the webhook URL in Linq to https://service.worldwide-home.com/api/hooks/linq?key=<FOLLOW_UP_WEBHOOK_KEY>
export async function POST(request: NextRequest) {
  if (!checkHookKey(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const event = await request.json().catch(() => null);
  const m = event?.data;
  if (!m || event?.event_type !== "message.received" || m.sender_handle?.is_me || !m.chat?.id) return NextResponse.json({ ok: true });
  const body = ((m.parts ?? []) as any[]).filter((p) => p?.type === "text" && typeof p.value === "string").map((p) => p.value).join("\n").trim();
  if (!body) return NextResponse.json({ ok: true });
  const { data: chat } = await db().from("follow_chats").select("id").eq("linq_group_id", m.chat.id).maybeSingle();
  if (!chat) return NextResponse.json({ ok: true });
  await saveInbound(chat.id, { body, sender: m.sender_handle?.handle ?? null, externalId: m.id ?? null, at: m.sent_at ?? null });
  return NextResponse.json({ ok: true });
}
