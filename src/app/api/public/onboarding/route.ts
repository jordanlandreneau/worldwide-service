import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/data";
import { importOnboarding } from "@/lib/onboarding";

// The Admin Hub sends each Service BDC onboarding form here right after it's submitted.
// The form itself is public, so this only ever creates an inactive draft store for review.
// If SERVICE_ONBOARDING_KEY is set in Vercel, the matching x-onboarding-key header is required.
export async function POST(request: NextRequest) {
  const key = process.env.SERVICE_ONBOARDING_KEY;
  if (key && request.headers.get("x-onboarding-key") !== key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = await request.text();
  if (raw.length > 200_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  let form: Record<string, unknown>;
  try { form = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  if (!form || typeof form !== "object" || Array.isArray(form)) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  if (form.form_type && form.form_type !== "Service BDC") return NextResponse.json({ error: "not a Service form" }, { status: 400 });
  // A flood guard: no more than 20 forms in 10 minutes.
  const { count } = await db().from("onboarding_submissions").select("id", { count: "exact", head: true }).gt("created_at", new Date(Date.now() - 600_000).toISOString());
  if ((count ?? 0) >= 20) return NextResponse.json({ error: "too many submissions, try again later" }, { status: 429 });
  const out = await importOnboarding(form);
  if ("error" in out) return NextResponse.json(out, { status: 400 });
  return NextResponse.json(out);
}
