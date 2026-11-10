import { NextResponse, type NextRequest } from "next/server";
import { atLeast, getUser } from "@/lib/access";
import { googleFinishSignIn } from "@/lib/follow-providers";
import { importGoogleSpaces } from "@/lib/follow-sync";
import { SITE_URL } from "@/lib/site";

export async function GET(request: NextRequest) {
  const back = (s: string, n?: number) => {
    const res = NextResponse.redirect(`${SITE_URL}/follow-up?channel=google_chat&google=${s}${n !== undefined ? `&added=${n}` : ""}`);
    res.cookies.delete("g_state");
    res.cookies.delete("g_mine");
    return res;
  };
  const user = await getUser();
  const mine = request.cookies.get("g_mine")?.value === "1";
  if (!user || !atLeast(user.role, mine ? "agent" : "manager")) return back("denied");
  const q = request.nextUrl.searchParams;
  const state = request.cookies.get("g_state")?.value;
  if (!state || state !== q.get("state")) return back("expired");
  const code = q.get("code");
  if (!code) return back("cancelled");
  try {
    await googleFinishSignIn(code, mine ? user.email : null);
  } catch {
    return back("failed");
  }
  if (mine) return back("mine");
  const added = await importGoogleSpaces(user.email).catch(() => 0);
  return back("connected", added);
}
