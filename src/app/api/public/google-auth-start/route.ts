import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { atLeast, getUser } from "@/lib/access";
import { googleSignInUrl, googleUserConfigured } from "@/lib/follow-providers";
import { SITE_URL } from "@/lib/site";

// A manager signs in once with the BDC's Google account; Follow-ups reads and sends Google Chat messages as that account.
export async function GET() {
  const user = await getUser();
  if (!user || !atLeast(user.role, "manager")) return NextResponse.redirect(`${SITE_URL}/follow-up`);
  if (!googleUserConfigured()) return NextResponse.redirect(`${SITE_URL}/follow-up?channel=google_chat&google=missing`);
  const state = randomBytes(18).toString("base64url");
  const res = NextResponse.redirect(googleSignInUrl(state));
  res.cookies.set("g_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
