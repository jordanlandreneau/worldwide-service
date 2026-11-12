import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { db } from "@/lib/data";

// Webhooks prove they're ours with ?key=FOLLOW_UP_WEBHOOK_KEY. With no key set, they're refused.
export function checkHookKey(request: NextRequest) {
  const want = process.env.FOLLOW_UP_WEBHOOK_KEY ?? "";
  const got = request.nextUrl.searchParams.get("key") ?? "";
  if (!want || want.length !== got.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(got));
}

const digits = (v: string | null) => (v ?? "").replace(/\D/g, "").slice(-10);

// Saves a store's reply, naming the sender from the chat's people list when the number matches.
export async function saveInbound(chatId: string, m: { body: string; sender: string | null; senderName?: string | null; externalId: string | null; at: string | number | null; attachments?: unknown[] }) {
  const client = db();
  let name: string | null = m.senderName ?? null;
  const last10 = digits(m.sender);
  if (!name && last10.length === 10) {
    const { data: people } = await client.from("follow_members").select("name,phone").eq("chat_id", chatId);
    name = ((people ?? []) as any[]).find((p) => digits(p.phone) === last10)?.name ?? null;
  }
  const when = typeof m.at === "number" || /^\d+$/.test(String(m.at ?? "")) ? new Date(Number(m.at) * (Number(m.at) < 1e12 ? 1000 : 1)) : m.at ? new Date(m.at) : new Date();
  const created_at = Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString();
  await client.from("follow_messages").upsert({
    chat_id: chatId, direction: "inbound", body: m.body.slice(0, 8000), sender: m.sender, sender_name: name, attachments: m.attachments ?? [],
    status: "received", external_id: m.externalId, read: false, created_at,
  }, { onConflict: "chat_id,external_id", ignoreDuplicates: true });
  await client.from("follow_chats").update({ last_activity: new Date().toISOString() }).eq("id", chatId);
}
