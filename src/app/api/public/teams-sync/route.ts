import { NextResponse, type NextRequest } from "next/server";
import { checkHookKey } from "@/lib/follow-inbound";
import { pullTeams, pullWhatsApp } from "@/lib/follow-sync";

// Lets a scheduler pull Teams replies: GET /api/public/teams-sync?key=FOLLOW_UP_WEBHOOK_KEY
export async function GET(request: NextRequest) {
  if (!checkHookKey(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [teams, whatsapp] = await Promise.all([pullTeams(true), pullWhatsApp(true)]);
  return NextResponse.json({ teams, whatsapp });
}
