import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC = ["/login", "/auth/callback", "/auth/accept", "/forgot-password", "/no-access"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (process.env.NODE_ENV === "development" && process.env.DEV_USER_ROLE) return response;
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  // Only refreshes the session and sends signed-out visitors to sign in. Every page and action
  // still verifies the user with Supabase through getUser, so this saves one trip on each request.
  const { data } = await supabase.auth.getSession();
  const { pathname } = request.nextUrl;
  if (!data.session && !PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|media/|brand/|worldwide.css|app-extras.css|favicon.ico).*)"],
};
