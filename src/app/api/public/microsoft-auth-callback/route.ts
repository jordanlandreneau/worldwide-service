import { NextResponse, type NextRequest } from "next/server";
import { atLeast, getUser } from "@/lib/access";
import { teamsFinishSignIn } from "@/lib/follow-providers";
import { SITE_URL } from "@/lib/site";

export async function GET(request: NextRequest) {
  const back = (s: string) => {
    const res = NextResponse.redirect(`${SITE_URL}/follow-up?channel=teams&teams=${s}`);
    res.cookies.delete("ms_state");
    return res;
  };
  const user = await getUser();
  if (!user || !atLeast(user.role, "manager")) return back("denied");
  const q = request.nextUrl.searchParams;
  const state = request.cookies.get("ms_state")?.value;
  if (!state || state !== q.get("state")) return back("expired");
  const code = q.get("code");
  if (!code) return back("cancelled");
  try {
    await teamsFinishSignIn(code);
    return back("connected");
  } catch {
    return back("failed");
  }
}
