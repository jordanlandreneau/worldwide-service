import { NextResponse } from "next/server";
import { atLeast, getUser } from "@/lib/access";
import { csv, dateRange, dimension, lookups, many, production, STATUS, tally } from "@/lib/report";
import { showLocal } from "@/lib/scope";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user || !atLeast(user.role, "manager")) return new NextResponse("Not allowed", { status: 403 });
  const q = new URL(req.url).searchParams;
  const get = (k: string) => q.get(k) ?? "";
  const range = dateRange(get("range") || "30", get("from"), get("to"));
  const f = { teams: many(q.getAll("team")), stores: many(q.getAll("d")), users: many(q.getAll("user")), statuses: many(q.getAll("status")).filter((s) => STATUS.some(([k]) => k === s)) };
  const look = await lookups();
  const rows = await production(range.from, range.to, f, look);
  let out: (string | number | null)[][];
  if (get("kind") === "rows") {
    out = [["Set on", "Scheduled", "Customer", "Phone", "Dealership", "Campaign", "Set by", "Status", "Notes"], ...rows.map((r) => {
      const tz = look.stores.get(r.dealership_id)?.timezone ?? "America/New_York";
      return [showLocal(r.created_at, tz), showLocal(r.appt_at, tz), r.customer_name, r.phone, dimension(r, "dealership", look), dimension(r, "campaign", look), dimension(r, "creator", look), dimension(r, "status", look), r.notes];
    })];
  } else {
    const by = ["dealership", "team", "creator", "campaign", "status"].includes(get("by")) ? get("by") : "dealership";
    out = [[by, "Count", "Share", "Avg per day"], ...tally(rows, by, look).map(([n, c]) => [n, c, `${((c / rows.length) * 100).toFixed(1)}%`, (c / range.days).toFixed(1)])];
  }
  return new Response(csv(out), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="appointments-${range.from}-to-${range.to}.csv"`, "Cache-Control": "no-store" } });
}
