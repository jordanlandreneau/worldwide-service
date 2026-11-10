import { NextResponse } from "next/server";
import { atLeast, getUser } from "@/lib/access";
import { justcall } from "@/lib/justcall";

// Temporary: admins only. Shows how JustCall answers a few call-list filters (counts and sample fields, no customer data).
export async function GET(req: Request) {
  const user = await getUser();
  if (!user || !atLeast(user.role, "admin")) return new NextResponse("Not allowed", { status: 403 });
  const line = new URL(req.url).searchParams.get("line") ?? "";
  const d = line.replace(/\D/g, "").slice(-10);
  const now = new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace("T", " ");
  const week = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 19).replace("T", " ");
  const variants: Record<string, string> = {
    none: "per_page=5",
    plus: `per_page=5&justcall_number=%2B1${d}`,
    plain: `per_page=5&justcall_number=1${d}`,
    ten: `per_page=5&justcall_number=${d}`,
    plusDates: `per_page=5&justcall_number=%2B1${d}&from_datetime=${encodeURIComponent(week)}&to_datetime=${encodeURIComponent(now)}`,
    dates: `per_page=5&from_datetime=${encodeURIComponent(week)}&to_datetime=${encodeURIComponent(now)}`,
  };
  const out: Record<string, unknown> = {};
  for (const [k, q] of Object.entries(variants)) {
    const res = await justcall(`/calls?${q}`);
    const body = await res.json().catch(() => null);
    const list = (body?.data ?? []) as any[];
    out[k] = { status: res.status, count: list.length, total: body?.total_count ?? body?.count ?? null, lines: list.map((c) => c.justcall_number), dates: list.map((c) => `${c.call_date} ${c.call_time}`), msg: body?.message ?? null };
  }
  return NextResponse.json(out);
}
