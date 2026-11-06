import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { atLeast, getUser } from "@/lib/access";
import { teamsConfigured, teamsSignInUrl } from "@/lib/follow-providers";
import { SITE_URL } from "@/lib/site";

// A manager signs in once with the BDC's Teams account; Follow-ups sends and reads Teams chats as that account.
export async function GET() {
  const user = await getUser();
  if (!user || !atLeast(user.role, "manager")) return NextResponse.redirect(`${SITE_URL}/follow-up`);
  if (!teamsConfigured()) return NextResponse.redirect(`${SITE_URL}/follow-up?channel=teams&teams=missing`);
  const state = randomBytes(18).toString("base64url");
  const res = NextResponse.redirect(teamsSignInUrl(state));
  res.cookies.set("ms_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
