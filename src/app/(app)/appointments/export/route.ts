import { findAppointments, APPT_STATUS } from "@/lib/appointment-list";
import { db, fetchAll } from "@/lib/data";
import { csv } from "@/lib/report";
import { inScope, requireScoped, showLocal } from "@/lib/scope";

// The Appointments list as a CSV, with the same filters as the page.
export async function GET(req: Request) {
  const { user, stores: scope } = await requireScoped();
  const q = new URL(req.url).searchParams;
  const store = q.get("d") ?? "";
  const storeOk = /^[0-9a-f-]{36}$/i.test(store) && inScope(scope, store);
  const rows = await findAppointments({ store: storeOk ? store : undefined, scope, agent: user.role === "dealership" ? undefined : q.get("agent") || undefined, status: q.get("status") || undefined, from: q.get("from") || undefined, to: q.get("to") || undefined, dates: q.get("dates") === "set" ? "set" : "appt", limit: 10000 });
  const [stores, users] = await Promise.all([fetchAll<any>("dealerships", "id,name,timezone", "name"), fetchAll<any>("app_users", "email,first_name,last_name", "email")]);
  const S = new Map(stores.map((s) => [s.id, s]));
  const U = new Map(users.map((u) => [String(u.email).toLowerCase(), `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.email]));
  const ids = [...new Set(rows.map((r) => r.campaign_id).filter(Boolean))];
  const { data: camps } = ids.length ? await db().from("campaigns").select("id,name").in("id", ids) : { data: [] };
  const C = new Map(((camps ?? []) as any[]).map((c) => [c.id, c.name]));
  const out = [["Appointment date & time", "Set on", "Dealership", "Customer", "Phone", "Campaign", "Status", "Set by", "Notes"], ...rows.map((r) => {
    const tz = S.get(r.dealership_id)?.timezone ?? "America/New_York";
    return [showLocal(r.appt_at, tz), showLocal(r.created_at, tz), S.get(r.dealership_id)?.name ?? "", r.customer_name, r.phone, r.campaign_id ? C.get(r.campaign_id) ?? "" : "", APPT_STATUS.find(([k]) => k === r.status)?.[1] ?? r.status, user.role === "dealership" ? "Worldwide BDC" : U.get(String(r.created_by).toLowerCase()) ?? r.created_by, r.notes ?? ""];
  })];
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return new Response(csv(out), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="appointments-${day}.csv"`, "Cache-Control": "no-store" } });
}
