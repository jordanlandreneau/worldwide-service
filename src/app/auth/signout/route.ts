import { SITE_URL } from "@/lib/site";
import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient } from "@/lib/supabase-auth";

export async function POST(request: NextRequest) {
  const supabase = await createAuthClient();
  await supabase.auth.signOut();
  const origin = process.env.NODE_ENV === "production" ? SITE_URL : new URL(request.url).origin;
  return NextResponse.redirect(`${origin}/login`, 303);
}
