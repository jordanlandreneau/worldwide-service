import "server-only";
import { getUser, type SessionUser } from "@/lib/access";
import { db } from "@/lib/data";
import { redirect } from "next/navigation";

// Any signed-in role. Dealership users only get the stores assigned to them. null means every store.
export async function requireScoped(): Promise<{ user: SessionUser; stores: string[] | null }> {
  const user = await getUser();
  if (!user) redirect("/no-access");
  if (user.role !== "dealership") return { user, stores: null };
  const { data } = await db().from("user_dealerships").select("dealership_id").eq("user_id", user.id ?? "00000000-0000-0000-0000-000000000000");
  return { user, stores: (data ?? []).map((r) => r.dealership_id as string) };
}

export const inScope = (stores: string[] | null, id: string) => stores === null || stores.includes(id);

// Converts a store's local date and time to an exact moment, including daylight saving.
export function localToUtc(date: string, time: string, timeZone: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const offsetAt = (at: Date) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - at.getTime();
  };
  const first = new Date(guess.getTime() - offsetAt(guess));
  return new Date(guess.getTime() - offsetAt(first));
}

export function localParts(at: string | Date, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: p.weekday as string };
}

export function showLocal(at: string, timeZone: string) {
  try {
    return new Date(at).toLocaleString("en-US", { timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  } catch {
    return new Date(at).toUTCString();
  }
}

const NONE = "00000000-0000-0000-0000-000000000000";
// Limits a chosen list of stores to what this user can see. Never empty for a limited user,
// because an empty filter would otherwise mean every store.
export function limitStores(chosen: string[], stores: string[] | null) {
  if (stores === null) return chosen;
  const allowed = chosen.length ? chosen.filter((id) => stores.includes(id)) : stores;
  return allowed.length ? allowed : [NONE];
}

// Every JustCall line on the user's stores, in the form saved calls use. null means no limit.
export async function linesFor(stores: string[] | null): Promise<string[] | null> {
  if (stores === null) return null;
  if (!stores.length) return [];
  const client = db();
  const [{ data: own }, { data: links }] = await Promise.all([
    client.from("dealerships").select("just_call_number,just_call_campaign_number,sales_dial_number,sales_text_number").in("id", stores),
    client.from("dealership_departments").select("just_call_number").in("dealership_id", stores),
  ]);
  const out = new Set<string>();
  const add = (v: unknown) => { const d = String(v ?? "").replace(/\D/g, ""); if (d.length >= 10) out.add(`1${d.slice(-10)}`); };
  for (const r of own ?? []) { add(r.just_call_number); add(r.just_call_campaign_number); add(r.sales_dial_number); add(r.sales_text_number); }
  for (const r of links ?? []) add(r.just_call_number);
  return [...out];
}
export const lineAllowed = (lines: string[] | null, number: unknown) => {
  if (lines === null) return true;
  const d = String(number ?? "").replace(/\D/g, "");
  return d.length >= 10 && lines.includes(`1${d.slice(-10)}`);
};
