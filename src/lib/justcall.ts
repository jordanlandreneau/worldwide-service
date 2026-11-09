import "server-only";
import { db, fetchAll } from "@/lib/data";

const BASE = "https://api.justcall.io/v2.1";
const RETRIES = 2;
const MAX_WAIT_MS = 5000;
const digits = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "");
export const lineKey = (v: string | null | undefined) => digits(v).slice(-10);
export function e164(v: string) {
  const d = digits(v);
  if (d.length === 10) return `+1${d}`;
  return d ? `+${d}` : "";
}

export async function justcall(path: string, init?: RequestInit, retries = RETRIES) {
  const key = process.env.JUSTCALL_API_KEY;
  const secret = process.env.JUSTCALL_API_SECRET;
  if (!key || !secret) throw new Error("JustCall isn't connected yet.");
  // A 429 means JustCall refused the request, so trying again can't send a text twice.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      cache: "no-store",
      headers: { Authorization: `${key}:${secret}`, Accept: "application/json", "Content-Type": "application/json", ...init?.headers },
    });
    if (res.status !== 429 || attempt >= retries) return res;
    const asked = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(asked) && asked > 0 ? Math.min(asked * 1000, MAX_WAIT_MS) : 2000 * (attempt + 1);
    await new Promise((r) => setTimeout(r, wait));
  }
}

export function extractCode(body: string): string | null {
  if (!/\b(code|passcode|otp|verification|verify|pin|one[- ]time)\b/i.test(body)) return null;
  const nearby = body.match(/\b(?:code|passcode|otp|pin)\b[^0-9]{0,30}(\d{4,8})\b/i) ?? body.match(/\b(\d{4,8})\b[^0-9]{0,30}\b(?:code|passcode|otp|pin)\b/i);
  return nearby?.[1] ?? body.match(/\b\d{4,8}\b/)?.[0] ?? null;
}

const senderKey = (v: string | null | undefined) => { const d = String(v ?? "").replace(/\D/g, ""); return d.length >= 5 ? d.slice(-10) : ""; };

// All lines on the dealership pages. A number shared by several stores has no single owner.
async function dealershipLines() {
  const [stores, links] = await Promise.all([
    fetchAll<any>("dealerships", "id,just_call_number,code_sender_number", "id"),
    fetchAll<any>("dealership_departments", "dealership_id,just_call_number", "dealership_id"),
  ]);
  const owners = new Map<string, Set<string>>();
  const add = (n: string | null, id: string) => {
    const k = lineKey(n);
    if (k.length === 10) owners.set(k, (owners.get(k) ?? new Set()).add(id));
  };
  for (const s of stores) add(s.just_call_number, s.id);
  for (const l of links) add(l.just_call_number, l.dealership_id);
  // Sender numbers: short codes keep all their digits, phone numbers use the last 10.
  const senders = new Map<string, Set<string>>();
  for (const s of stores) {
    const k = senderKey(s.code_sender_number);
    if (k) senders.set(k, (senders.get(k) ?? new Set()).add(s.id));
  }
  return { owners, senders };
}

const MIN_GAP_MS = 30_000;
const KEEP_MS = 24 * 60 * 60 * 1000;
export const codeCutoff = () => new Date(Date.now() - KEEP_MS).toISOString();
const MAX_PAGES = 3;

// Reads only. It doesn't change webhooks or anything else 3.0 relies on.
export async function syncCodes(): Promise<{ added: number; skipped?: boolean; error?: string }> {
  const client = db();
  const { data: state } = await client.from("justcall_sync").select("*").eq("name", "codes").maybeSingle();
  if (state?.synced_at && Date.now() - new Date(state.synced_at as string).getTime() < MIN_GAP_MS) return { added: 0, skipped: true };
  // Claim this check first, so several open pages don't all ask JustCall at once.
  await client.from("justcall_sync").upsert({ name: "codes", last_sms_id: state?.last_sms_id ?? 0, synced_at: new Date().toISOString() });
  // Codes are only kept for 24 hours. This runs even if JustCall is unreachable.
  await client.from("verification_codes").delete().lt("sms_at", codeCutoff());
  const lastId = Number(state?.last_sms_id ?? 0);
  let newest = lastId;
  let added = 0;
  try {
    const { owners, senders } = await dealershipLines();
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await justcall(`/texts?sms_direction=incoming&sort=id&order=desc&per_page=100&page=${page}`, undefined, 0);
      if (!res.ok) {
        // Wait before asking again, so Codes doesn't add to a rate limit shared with 3.0.
        await client.from("justcall_sync").upsert({ name: "codes", last_sms_id: lastId, synced_at: new Date().toISOString() });
        return { added, error: res.status === 429 ? "JustCall is busy right now." : `JustCall answered ${res.status}.` };
      }
      const list: any[] = (await res.json())?.data ?? [];
      const rows = [];
      let reachedKnown = list.length === 0;
      for (const sms of list) {
        const id = Number(sms.id);
        if (id <= lastId) { reachedKnown = true; continue; }
        newest = Math.max(newest, id);
        // The JustCall line it arrived on decides the store; a known sender number settles a shared line.
        const byLine = owners.get(lineKey(sms.justcall_number));
        const bySender = senders.get(senderKey(sms.contact_number));
        const both = byLine && bySender ? new Set([...byLine].filter((x) => bySender.has(x))) : null;
        const line = both?.size ? both : byLine?.size === 1 ? byLine : bySender ?? byLine;
        const body = String(sms.sms_info?.body ?? "");
        const code = line ? extractCode(body) : null;
        const when = `${sms.sms_date ?? ""}T${sms.sms_time ?? "00:00:00"}Z`;
        if (!line || !code || Date.parse(when) < Date.now() - KEEP_MS) continue;
        rows.push({
          justcall_sms_id: id, code, body, contact_number: sms.contact_number ?? null, contact_name: sms.contact_name ?? null,
          justcall_number: sms.justcall_number ?? null, line_name: sms.justcall_line_name ?? null,
          dealership_id: line.size === 1 ? [...line][0] : null,
          sms_at: Number.isNaN(Date.parse(when)) ? new Date().toISOString() : when,
        });
      }
      if (rows.length) {
        const { error } = await client.from("verification_codes").upsert(rows, { onConflict: "justcall_sms_id" });
        if (error) return { added, error: "Couldn't save new codes." };
        added += rows.length;
      }
      if (reachedKnown) break;
    }
    await client.from("justcall_sync").upsert({ name: "codes", last_sms_id: newest, synced_at: new Date().toISOString() });
    return { added };
  } catch (e) {
    return { added, error: e instanceof Error && e.message.includes("connected") ? e.message : "Couldn't reach JustCall." };
  }
}

// Pages share JustCall's rate limit with 3.0, so reads are held briefly and only retried a little.
export async function justcallRead(path: string, seconds = 60, tries = 3): Promise<{ data?: any; error?: string; busy?: boolean }> {
  const key = process.env.JUSTCALL_API_KEY;
  const secret = process.env.JUSTCALL_API_SECRET;
  if (!key || !secret) return { error: "JustCall isn't connected yet." };
  try {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(`${BASE}${path}`, { next: { revalidate: seconds }, headers: { Authorization: `${key}:${secret}`, Accept: "application/json" } });
      if (res.status === 429) {
        if (attempt < tries) { await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
        return { error: "JustCall is busy right now. Try again in a minute.", busy: true };
      }
      if (!res.ok) return { error: `JustCall answered ${res.status}.` };
      return { data: await res.json() };
    }
  } catch {
    return { error: "Couldn't reach JustCall." };
  }
}
