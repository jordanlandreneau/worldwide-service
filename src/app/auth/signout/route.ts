import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient } from "@/lib/supabase-auth";

export async function POST(request: NextRequest) {
  const supabase = await createAuthClient();
  await supabase.auth.signOut();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  return NextResponse.redirect(`${origin}/login`, 303);
}
