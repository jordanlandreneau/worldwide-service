import "server-only";
import { db, fetchAll } from "@/lib/data";
import { localParts } from "@/lib/scope";

const NY = "America/New_York";
export const PRESETS: [string, string][] = [["today", "Today"], ["yesterday", "Yesterday"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["month", "This month"], ["prev", "Previous month"], ["custom", "Custom range"]];
export const STATUS: [string, string][] = [["set", "Set"], ["showed", "Showed"], ["no_show", "No show"], ["cancelled", "Cancelled"], ["rescheduled", "Rescheduled"]];
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const todayNy = () => localParts(new Date(), NY).date;
export const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

export function dateRange(preset = "30", from?: string, to?: string) {
  const today = todayNy();
  const first = `${today.slice(0, 7)}-01`;
  let a = shift(today, -29), b = today;
  if (preset === "today") a = today;
  else if (preset === "yesterday") a = b = shift(today, -1);
  else if (preset === "7") a = shift(today, -6);
  else if (preset === "month") a = first;
  else if (preset === "prev") { b = shift(first, -1); a = `${b.slice(0, 7)}-01`; }
  else if (preset === "custom" && isDate(from) && isDate(to) && from <= to) { a = from; b = to; }
  const days = Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
  return { preset, from: a, to: b, days };
}
export const monthWindows = () => {
  const today = todayNy();
  const first = `${today.slice(0, 7)}-01`;
  const end = shift(first, -1);
  return { today, first, lastFirst: `${end.slice(0, 7)}-01`, lastEnd: end };
};

export type Lookups = { stores: Map<string, any>; storeList: any[]; teams: string[]; people: Map<string, string>; campaigns: Map<string, string> };
export async function lookups(): Promise<Lookups> {
  const [storeList, teams, users, campaigns] = await Promise.all([
    fetchAll<any>("dealerships", "id,name,team_name,timezone,active", "name"),
    fetchAll<any>("teams", "name", "name"),
    fetchAll<any>("app_users", "email,first_name,last_name", "email"),
    fetchAll<any>("campaigns", "id,name,category", "id"),
  ]);
  return {
    storeList, stores: new Map(storeList.map((s) => [s.id, s])), teams: teams.map((t) => t.name as string).filter((n) => /^service (group|leadership)\b/i.test(n)),
    people: new Map(users.map((u) => [String(u.email).toLowerCase(), `${u.first_name} ${u.last_name}`.trim() || u.email])),
    campaigns: new Map(campaigns.map((c) => [c.id, c.name])),
  };
}

export type Filters = { teams: string[]; stores: string[]; users: string[]; statuses: string[] };

// "Set" days are each store's own calendar day, so the search starts and ends a day wider and is trimmed after.
export async function production(from: string, to: string, f: Filters, look: Lookups, ignoreUser = false) {
  const rows: any[] = [];
  const start = `${shift(from, -1)}T00:00:00Z`;
  const end = `${shift(to, 2)}T00:00:00Z`;
  for (let at = 0; ; at += 1000) {
    let q = db().from("appointments").select("id,created_at,appt_at,customer_name,phone,dealership_id,campaign_id,created_by,status,notes")
      .gte("created_at", start).lt("created_at", end).order("created_at", { ascending: false }).range(at, at + 999);
    if (f.stores.length) q = q.in("dealership_id", f.stores);
    if (f.statuses.length) q = q.in("status", f.statuses);
    if (!ignoreUser && f.users.length) q = q.in("created_by", f.users);
    const { data, error } = await q;
    if (error) throw new Error(`appointments: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows.filter((r) => {
    const s = look.stores.get(r.dealership_id);
    if (f.teams.length && !f.teams.includes(s?.team_name ?? "")) return false;
    const day = localParts(r.created_at, s?.timezone ?? NY).date;
    return day >= from && day <= to;
  });
}

export function dimension(row: any, key: string, look: Lookups): string {
  const store = look.stores.get(row.dealership_id);
  switch (key) {
    case "team": return store?.team_name ?? "No team";
    case "creator": return look.people.get(String(row.created_by).toLowerCase()) ?? row.created_by ?? "Unknown";
    case "campaign": return row.campaign_id ? look.campaigns.get(row.campaign_id) ?? "Deleted campaign" : "No campaign";
    case "status": return STATUS.find(([k]) => k === row.status)?.[1] ?? row.status;
    default: return store?.name ?? "Unknown";
  }
}
export function tally(rows: any[], key: string, look: Lookups) {
  const m = new Map<string, number>();
  for (const r of rows) { const k = dimension(r, key, look); m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
export function csv(rows: (string | number | null | undefined)[][]) {
  // A leading = + - or @ would run as a formula in Excel, and customer names come from outside.
  const cell = (v: string | number | null | undefined) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
