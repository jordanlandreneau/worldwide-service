"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/data";
import type { Result } from "@/lib/manage";
import { atLeast } from "@/lib/access";
import { requireScoped } from "@/lib/scope";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FILE = 4 * 1024 * 1024;
const MAX_ROWS = 20000;
const text = (f: FormData, k: string, max = 4000) => {
  const v = String(f.get(k) ?? "").trim().slice(0, max);
  return v === "" ? null : v;
};
const refresh = () => revalidatePath("/command");

// Managers and admins edit the board and mark completion. Agents only view.
// Store logins see their own stores and upload lists; they can't mark completion.
async function staff(storeId: string) {
  const { user } = await requireScoped();
  if (!atLeast(user.role, "manager") || !UUID.test(storeId)) return null;
  return user;
}
async function member(storeId: string) {
  const { user, stores } = await requireScoped();
  if (!UUID.test(storeId) || (stores !== null && !stores.includes(storeId))) return null;
  if (user.role === "agent") return null;
  return user;
}
async function campaignInStore(storeId: string, id: string | null) {
  if (!id) return true;
  if (!UUID.test(id)) return false;
  const { data } = await db().from("campaigns").select("id").eq("id", id).eq("dealership_id", storeId).maybeSingle();
  return !!data;
}

export async function saveCampaign(storeId: string, id: string | null, _: Result, f: FormData): Promise<Result> {
  const user = await staff(storeId);
  if (!user) return { error: "You don't have access to this." };
  const category = text(f, "category", 120);
  const name = text(f, "name", 200);
  if (!category) return { error: "Enter a category." };
  if (!name) return { error: "Enter a campaign name." };
  const fields = {
    category, name,
    description: text(f, "description"), cadence: text(f, "cadence", 120), list_ref: text(f, "list_ref"),
    launch_date: text(f, "launch_date", 120), script: text(f, "script", 20000), info: text(f, "info", 20000),
    updated_at: new Date().toISOString(),
  };
  const client = db();
  if (id) {
    if (!(await campaignInStore(storeId, id))) return { error: "This campaign no longer exists." };
    const { error } = await client.from("campaigns").update(fields).eq("id", id).eq("dealership_id", storeId);
    if (error) return { error: "Couldn't save this campaign." };
  } else {
    const { count } = await client.from("campaigns").select("id", { count: "exact", head: true }).eq("dealership_id", storeId).eq("category", category);
    const { error } = await client.from("campaigns").insert({ ...fields, dealership_id: storeId, sort_order: count ?? 0, created_by: user.email });
    if (error) return { error: "Couldn't add this campaign." };
  }
  await client.from("edit_log").insert({ user_email: user.email, table_name: "campaigns", row_id: id ?? storeId, action: id ? "update campaign" : "add campaign" });
  refresh();
  return { ok: true };
}

export async function toggleWave(storeId: string, id: string, wave: 1 | 2) {
  const user = await staff(storeId);
  if (!user || !(await campaignInStore(storeId, id))) return;
  const column = wave === 1 ? "wave1_done" : "wave2_done";
  const client = db();
  const { data } = await client.from("campaigns").select(column).eq("id", id).maybeSingle();
  if (!data) return;
  await client.from("campaigns").update({ [column]: !(data as unknown as Record<string, boolean>)[column], updated_at: new Date().toISOString() }).eq("id", id);
  refresh();
}

export async function deleteCampaign(storeId: string, id: string) {
  const user = await staff(storeId);
  if (!user || !(await campaignInStore(storeId, id))) return;
  await db().from("campaigns").delete().eq("id", id).eq("dealership_id", storeId);
  await db().from("edit_log").insert({ user_email: user.email, table_name: "campaigns", row_id: id, action: "delete campaign" });
  refresh();
}

export async function addStat(storeId: string, _: Result, f: FormData): Promise<Result> {
  const user = await staff(storeId);
  if (!user) return { error: "You don't have access to this." };
  const campaignId = text(f, "campaign_id", 64);
  if (!campaignId || !(await campaignInStore(storeId, campaignId))) return { error: "Choose a campaign." };
  const date = text(f, "stat_date", 10);
  if (!date || !DATE.test(date)) return { error: "Choose a date." };
  const calls = Number(f.get("calls_made") ?? 0);
  const appts = Number(f.get("appointments_set") ?? 0);
  if (![calls, appts].every((n) => Number.isInteger(n) && n >= 0 && n <= 100000)) return { error: "Calls and appointments must be whole numbers." };
  if (appts > calls && calls > 0) return { error: "Appointments set can't be more than calls made." };
  const { error } = await db().from("campaign_stats").insert({
    campaign_id: campaignId, dealership_id: storeId, stat_date: date, calls_made: calls, appointments_set: appts,
    notes: text(f, "notes", 1000), entered_by: user.email,
  });
  if (error) return { error: "Couldn't save this entry." };
  refresh();
  return { ok: true };
}

export async function deleteStat(storeId: string, id: string) {
  const user = await staff(storeId);
  if (!user || !UUID.test(id)) return;
  await db().from("campaign_stats").delete().eq("id", id).eq("dealership_id", storeId);
  refresh();
}

// RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes.
function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = input.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

export async function uploadList(storeId: string, _: Result, f: FormData): Promise<Result> {
  const user = await member(storeId);
  if (!user) return { error: "You don't have access to this store." };
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (!/\.csv$/i.test(file.name)) return { error: "The file must be a .csv file. In Excel or Google Sheets, use File > Download > CSV." };
  if (file.size > MAX_FILE) return { error: "The file is over 4 MB. Split it into smaller files." };
  const campaignId = text(f, "campaign_id", 64);
  if (campaignId && !(await campaignInStore(storeId, campaignId))) return { error: "Choose a campaign from this store." };
  const all = parseCsv(await file.text());
  if (all.length < 2) return { error: "The file needs a header row and at least one customer." };
  const columns = all[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  const rows = all.slice(1);
  if (rows.length > MAX_ROWS) return { error: `The file has ${rows.length.toLocaleString()} rows. The limit is ${MAX_ROWS.toLocaleString()} per file.` };
  const { error } = await db().from("outbound_lists").insert({
    dealership_id: storeId, campaign_id: campaignId, file_name: file.name.slice(0, 200), columns, rows,
    row_count: rows.length, note: text(f, "note", 1000), uploaded_by: user.email,
  });
  if (error) return { error: "Couldn't save this list." };
  refresh();
  return { ok: true };
}

export async function deleteList(storeId: string, id: string) {
  const user = await staff(storeId);
  if (!user || !UUID.test(id)) return;
  await db().from("outbound_lists").delete().eq("id", id).eq("dealership_id", storeId);
  refresh();
}
