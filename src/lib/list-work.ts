import "server-only";
import { db } from "@/lib/data";
import { RETRY } from "@/lib/list-status";

export type WorkList = {
  id: string; storeId: string; store: string; tz: string; file: string; campaign: string | null; rows: number;
  dueAt: string | null; uploadedAt: string; done: number; retry: number; agents: { id: string; name: string }[];
};

// Outcome counts per sheet: done = a final outcome, retry = worth another call later.
export async function progressFor(listIds: string[]) {
  const out = new Map<string, { done: number; retry: number }>();
  if (!listIds.length) return out;
  const client = db();
  for (let from = 0; ; from += 1000) {
    const { data } = await client.from("list_progress").select("list_id,status").in("list_id", listIds).range(from, from + 999);
    const rows = (data ?? []) as any[];
    for (const r of rows) {
      const t = out.get(r.list_id) ?? { done: 0, retry: 0 };
      if (RETRY.has(r.status)) t.retry += 1; else t.done += 1;
      out.set(r.list_id, t);
    }
    if (rows.length < 1000) break;
  }
  return out;
}

// Sheets with their store, campaign, deadline, agents and progress. Pass a user to get only theirs.
export async function workLists(opts: { userId?: string | null; listIds?: string[] }): Promise<WorkList[]> {
  const client = db();
  let ids = opts.listIds ?? null;
  if (opts.userId !== undefined) {
    if (!opts.userId) return [];
    const { data } = await client.from("list_assignments").select("list_id").eq("user_id", opts.userId);
    ids = ((data ?? []) as any[]).map((r) => r.list_id);
  }
  if (!ids || !ids.length) return [];
  const { data: lists } = await client.from("outbound_lists").select("id,dealership_id,campaign_id,file_name,row_count,due_at,uploaded_at").in("id", ids);
  const L = (lists ?? []) as any[];
  const storeIds = [...new Set(L.map((l) => l.dealership_id))];
  const campIds = [...new Set(L.map((l) => l.campaign_id).filter(Boolean))];
  const [{ data: stores }, { data: camps }, { data: assigns }, progress] = await Promise.all([
    client.from("dealerships").select("id,name,timezone").in("id", storeIds),
    campIds.length ? client.from("campaigns").select("id,name").in("id", campIds) : Promise.resolve({ data: [] }),
    client.from("list_assignments").select("list_id,user_id").in("list_id", ids),
    progressFor(ids),
  ]);
  const userIds = [...new Set(((assigns ?? []) as any[]).map((a) => a.user_id))];
  const { data: users } = userIds.length ? await client.from("app_users").select("id,first_name,last_name,email").in("id", userIds) : { data: [] };
  const uname = new Map(((users ?? []) as any[]).map((u) => [u.id, [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email]));
  const S = new Map(((stores ?? []) as any[]).map((s) => [s.id, s]));
  const C = new Map(((camps ?? []) as any[]).map((c) => [c.id, c.name]));
  return L.map((l) => ({
    id: l.id, storeId: l.dealership_id, store: S.get(l.dealership_id)?.name ?? "Store", tz: S.get(l.dealership_id)?.timezone || "America/New_York",
    file: l.file_name, campaign: l.campaign_id ? C.get(l.campaign_id) ?? null : null, rows: l.row_count, dueAt: l.due_at, uploadedAt: l.uploaded_at,
    done: progress.get(l.id)?.done ?? 0, retry: progress.get(l.id)?.retry ?? 0,
    agents: ((assigns ?? []) as any[]).filter((a) => a.list_id === l.id).map((a) => ({ id: a.user_id, name: uname.get(a.user_id) ?? "Agent" })),
  }));
}
