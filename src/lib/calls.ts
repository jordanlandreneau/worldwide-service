import "server-only";
import { db } from "@/lib/data";
import { e164, justcall, lineKey } from "@/lib/justcall";

export type Call = {
  id: number; at: string; direction: string; type: string; status: string; agent: string | null;
  contact: string; contactName: string | null; line: string; lineName: string | null;
  talk: number; total: number; friendly: string | null; disposition: string | null; notes: string | null;
  hasRecording: boolean; connected: boolean;
};

// The JustCall lines that belong to a store: its own line and its department lines.
export async function storeLines(storeId: string): Promise<string[]> {
  const client = db();
  const [{ data: s }, { data: d }] = await Promise.all([
    client.from("dealerships").select("just_call_number").eq("id", storeId).maybeSingle(),
    client.from("dealership_departments").select("just_call_number").eq("dealership_id", storeId),
  ]);
  const all = [s?.just_call_number, ...((d ?? []) as any[]).map((x) => x.just_call_number)].map((n) => lineKey(n)).filter((k) => k.length === 10);
  return [...new Set(all)];
}

// A call "connected" when there was a conversation with the customer.
const isConnected = (c: any) => Number(c?.call_duration?.conversation_time ?? 0) > 0 || /^answered$/i.test(String(c?.call_info?.type ?? ""));

function toCall(c: any): Call {
  return {
    id: Number(c.id), at: `${c.call_date ?? ""}T${c.call_time ?? "00:00:00"}Z`,
    direction: String(c.call_info?.direction ?? ""), type: String(c.call_info?.type ?? ""), status: String(c.call_info?.status ?? ""),
    agent: c.agent_name ?? null, contact: String(c.contact_number ?? ""), contactName: c.contact_name || null,
    line: String(c.justcall_number ?? ""), lineName: c.justcall_line_name ?? null,
    talk: Number(c.call_duration?.conversation_time ?? 0), total: Number(c.call_duration?.total_duration ?? 0),
    friendly: c.call_duration?.friendly_duration ?? null, disposition: c.call_info?.disposition || null, notes: c.call_info?.notes || null,
    hasRecording: !!(c.call_info?.recording || c.call_info?.recording_child), connected: isConnected(c),
  };
}

const stamp = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

// Calls on a store's lines between two dates, newest first. Reads up to `maxPages` pages of 100 per line.
export async function storeCalls(storeId: string, from: Date, to: Date, opts: { direction?: string; maxPages?: number } = {}): Promise<{ calls: Call[]; lines: string[]; error?: string; capped?: boolean }> {
  const lines = await storeLines(storeId);
  if (!lines.length) return { calls: [], lines };
  const out: Call[] = [];
  let capped = false;
  try {
    await Promise.all(lines.map(async (line) => {
      for (let page = 0; page < (opts.maxPages ?? 5); page++) {
        // JustCall is strict about these parameters; try the full filter first, then simpler forms.
        const tries = [
          { justcall_number: e164(line), from_datetime: stamp(from), to_datetime: stamp(to), per_page: "100", page: String(page), sort: "id", order: "desc" },
          { justcall_number: e164(line).replace(/^\+/, ""), from_datetime: stamp(from), to_datetime: stamp(to), per_page: "100", page: String(page) },
          { justcall_number: e164(line), from_datetime: stamp(from).slice(0, 10), to_datetime: stamp(to).slice(0, 10), per_page: "100", page: String(page) },
        ];
        const ask = (t: Record<string, string>) => {
          const q = new URLSearchParams(t);
          if (opts.direction) q.set("call_direction", opts.direction);
          return justcall(`/calls?${q}`);
        };
        let res = await ask(tries[0]);
        let why = "";
        for (let k = 1; !res.ok && res.status === 400 && k < tries.length; k++) {
          why = (await res.text().catch(() => "")).slice(0, 300);
          res = await ask(tries[k]);
        }
        if (!res.ok) {
          if (!why) why = (await res.text().catch(() => "")).slice(0, 300);
          throw new Error(res.status === 401 || res.status === 403 ? "JustCall refused the request. Check the JustCall API key in Vercel." : `JustCall said ${res.status}: ${why}`);
        }
        const body = await res.json();
        const list = (body?.data ?? []) as any[];
        out.push(...list.map(toCall));
        if (list.length < 100) return;
        if (page === (opts.maxPages ?? 5) - 1) capped = true;
      }
    }));
  } catch (e) {
    return { calls: out, lines, error: e instanceof Error ? e.message : "Couldn't reach JustCall." };
  }
  const seen = new Set<number>();
  const calls = out.filter((c) => !seen.has(c.id) && seen.add(c.id)).sort((a, b) => b.at.localeCompare(a.at));
  return { calls, lines, capped };
}

// One call, checked against the store's lines, with its recording link (for the audio player).
export async function callRecording(callId: string, allowedLines: Set<string>) {
  if (!/^\d{1,15}$/.test(callId)) return null;
  const res = await justcall(`/calls/${callId}`);
  if (!res.ok) return null;
  const c = ((await res.json())?.data ?? null) as any;
  if (!c || !allowedLines.has(lineKey(c.justcall_number))) return null;
  const url = String(c.call_info?.recording || c.call_info?.recording_child || "");
  return /^https:\/\//i.test(url) ? url : null;
}
