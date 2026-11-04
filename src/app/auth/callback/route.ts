import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient } from "@/lib/supabase-auth";

export async function GET(request: NextRequest) {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  const code = new URL(request.url).searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/login`);
  const supabase = await createAuthClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login`);
  if (!data.user?.email?.toLowerCase().endsWith("@worldwidebdc.com")) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/no-access`);
  }
  return NextResponse.redirect(`${origin}/dashboard`);
}
