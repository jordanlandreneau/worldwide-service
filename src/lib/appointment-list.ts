import "server-only";
import { db } from "@/lib/data";
import { localToUtc } from "@/lib/scope";

export const APPT_STATUS: [string, string][] = [["set", "Set"], ["showed", "Showed"], ["no_show", "No show"], ["cancelled", "Cancelled"], ["rescheduled", "Rescheduled"]];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NY = "America/New_York";
export type ApptFilters = { store?: string; scope: string[] | null; agent?: string; status?: string; from?: string; to?: string; dates?: "appt" | "set"; limit?: number };

// The Appointments page and its CSV use the same search.
// Dates filter on the appointment's own date ("appt") or the day it was set ("set"), Eastern time.
export async function findAppointments(f: ApptFilters) {
  const col = f.dates === "set" ? "created_at" : "appt_at";
  let q = db().from("appointments").select("id,dealership_id,customer_name,phone,appt_at,campaign_id,notes,status,created_by,created_at").order(col, { ascending: false }).limit(f.limit ?? 500);
  if (f.store) q = q.eq("dealership_id", f.store);
  else if (f.scope !== null) q = q.in("dealership_id", f.scope.length ? f.scope : ["00000000-0000-0000-0000-000000000000"]);
  if (f.agent) q = q.eq("created_by", f.agent);
  if (f.from && DATE.test(f.from)) q = q.gte(col, localToUtc(f.from, "00:00", NY).toISOString());
  if (f.to && DATE.test(f.to)) q = q.lte(col, new Date(localToUtc(f.to, "23:59", NY).getTime() + 59_999).toISOString());
  if (f.status && APPT_STATUS.some(([k]) => k === f.status)) q = q.eq("status", f.status);
  const { data } = await q;
  return (data ?? []) as any[];
}
