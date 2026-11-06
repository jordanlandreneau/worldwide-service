import { createPublicKey, createVerify } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/data";
import { saveInbound } from "@/lib/follow-inbound";

// Google Chat posts the Chat app's events here (set in Google Cloud → Google Chat API → Configuration → HTTP endpoint).
// Each request carries a token signed by chat@system.gserviceaccount.com for our project number.
let keys: { at: number; list: any[] } | null = null;
async function verify(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return false;
  const head = JSON.parse(Buffer.from(h, "base64url").toString());
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  if (claims.iss !== "chat@system.gserviceaccount.com" || String(claims.aud) !== String(process.env.GOOGLE_CHAT_PROJECT_NUMBER ?? "") || claims.exp * 1000 < Date.now()) return false;
  if (!keys || Date.now() - keys.at > 3600_000) {
    const res = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com");
    keys = { at: Date.now(), list: ((await res.json()) as any).keys ?? [] };
  }
  const jwk = keys.list.find((k) => k.kid === head.kid);
  if (!jwk) return false;
  return createVerify("RSA-SHA256").update(`${h}.${p}`).verify(createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(s, "base64url"));
}

export async function POST(request: NextRequest) {
  if (!process.env.GOOGLE_CHAT_PROJECT_NUMBER || !(await verify(request).catch(() => false))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const event = await request.json().catch(() => null);
  const type = event?.type ?? (event?.chat?.messagePayload ? "MESSAGE" : null);
  const message = event?.message ?? event?.chat?.messagePayload?.message;
  const space = event?.space?.name ?? message?.space?.name ?? event?.chat?.messagePayload?.space?.name;
  if (type === "MESSAGE" && message && space && message.sender?.type !== "BOT") {
    const body = String(message.argumentText ?? message.text ?? "").trim();
    const { data: chat } = await db().from("follow_chats").select("id").eq("google_chat_space", space).maybeSingle();
    if (chat && body) await saveInbound(chat.id, { body, sender: message.sender?.name ?? null, senderName: message.sender?.displayName ?? null, externalId: message.name ?? null, at: message.createTime ?? null });
  }
  return NextResponse.json({});
}
