"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/data";
import type { Result } from "@/lib/manage";
import { atLeast } from "@/lib/access";
import { localToUtc, requireScoped, showLocal } from "@/lib/scope";
import { notifyAssigned, notifyListUpload } from "@/lib/assignments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FILE = 4 * 1024 * 1024;
const MAX_ROWS = 20000;
const text = (f: FormData, k: string, max = 4000) => {
  const v = String(f.get(k) ?? "").trim().slice(0, max);
  return v === "" ? null : v;
};
const refresh = () => revalidatePath("/command");
const TIME = /^\d{2}:\d{2}$/;

async function storeInfo(id: string) {
  const { data } = await db().from("dealerships").select("name,timezone").eq("id", id).maybeSingle();
  return { name: (data as any)?.name ?? "A store", tz: (data as any)?.timezone || "America/New_York" };
}
// "Due by" date and time, in the store's time zone. No date means no deadline.
function readDue(f: FormData, tz: string, prefix = "due"): { at: string | null; text: string | null } | string {
  const date = text(f, `${prefix}_date`, 10);
  if (!date) return { at: null, text: null };
  if (!DATE.test(date)) return "Enter the due date as a date.";
  const time = text(f, `${prefix}_time`, 5) ?? "17:00";
  if (!TIME.test(time)) return "Enter the due time as a time.";
  const at = localToUtc(date, time, tz);
  if (Number.isNaN(at.getTime())) return "That due date isn't valid.";
  return { at: at.toISOString(), text: showLocal(at.toISOString(), tz) };
}
const sameTime = (a: string | null | undefined, b: string | null | undefined) => (a ? new Date(a).getTime() : 0) === (b ? new Date(b).getTime() : 0);
const readAgent = (f: FormData, key = "assigned_to") => { const v = text(f, key, 64); return v && UUID.test(v) ? v : null; };

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
  const store = await storeInfo(storeId);
  const due = readDue(f, store.tz);
  if (typeof due === "string") return { error: due };
  const assignedTo = readAgent(f);
  const fields = {
    category, name, due_at: due.at, assigned_to: assignedTo,
    description: text(f, "description"), cadence: text(f, "cadence", 120), list_ref: text(f, "list_ref"),
    launch_date: text(f, "launch_date", 120), script: text(f, "script", 20000), info: text(f, "info", 20000),
    updated_at: new Date().toISOString(),
  };
  // A CSV can come with the campaign. Check it before saving anything.
  const file = f.get("file");
  const hasFile = file instanceof File && file.size > 0;
  let parsed: Parsed | null = null;
  if (hasFile) {
    const p = await readCsv(file);
    if (typeof p === "string") return { error: p };
    parsed = p;
  }
  const client = db();
  const rowId = id ?? randomUUID();
  let before: { assigned_to: string | null; due_at: string | null } | null = null;
  if (id) {
    if (!(await campaignInStore(storeId, id))) return { error: "This campaign no longer exists." };
    before = (await client.from("campaigns").select("assigned_to,due_at").eq("id", id).maybeSingle()).data as any;
    const { error } = await client.from("campaigns").update(fields).eq("id", id).eq("dealership_id", storeId);
    if (error) return { error: "Couldn't save this campaign." };
  } else {
    const { count } = await client.from("campaigns").select("id", { count: "exact", head: true }).eq("dealership_id", storeId).eq("category", category);
    const { error } = await client.from("campaigns").insert({ ...fields, id: rowId, dealership_id: storeId, sort_order: count ?? 0, created_by: user.email });
    if (error) return { error: "Couldn't add this campaign." };
  }
  await client.from("edit_log").insert({ user_email: user.email, table_name: "campaigns", row_id: rowId, action: id ? "update campaign" : "add campaign" });
  if (assignedTo && (assignedTo !== before?.assigned_to || !sameTime(due.at, before?.due_at))) {
    await notifyAssigned({ userId: assignedTo, storeId, storeName: store.name, what: `Campaign: ${category} · ${name}`, dueText: due.text, link: `/command?d=${storeId}`, by: user }).catch(() => undefined);
  }
  if (parsed && hasFile) {
    const listId = await saveList(storeId, rowId, file.name, parsed, text(f, "list_note", 1000), user.email, due.at, assignedTo);
    if (!listId) { refresh(); return { error: "The campaign was saved, but its list wasn't. Upload it again from the campaign." }; }
    await notifyListUpload({ storeId, storeName: store.name, listId, fileName: file.name, rows: parsed.rows.length, campaign: name, dueText: due.text, by: { email: user.email, name: user.name, dealership: false } }).catch(() => undefined);
  }
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

type Parsed = { columns: string[]; rows: string[][] };
async function readCsv(file: File): Promise<Parsed | string> {
  if (!/\.csv$/i.test(file.name)) return "The file must be a .csv file. In Excel or Google Sheets, use File > Download > CSV.";
  if (file.size > MAX_FILE) return "The file is over 4 MB. Split it into smaller files.";
  const all = parseCsv(await file.text());
  if (all.length < 2) return "The file needs a header row and at least one customer.";
  const rows = all.slice(1);
  if (rows.length > MAX_ROWS) return `The file has ${rows.length.toLocaleString()} rows. The limit is ${MAX_ROWS.toLocaleString()} per file.`;
  return { columns: all[0].map((h, i) => h.trim() || `Column ${i + 1}`), rows };
}
async function saveList(storeId: string, campaignId: string | null, name: string, p: Parsed, note: string | null, email: string, dueAt: string | null, assignedTo: string | null) {
  const { data, error } = await db().from("outbound_lists").insert({
    dealership_id: storeId, campaign_id: campaignId, file_name: name.slice(0, 200), columns: p.columns, rows: p.rows,
    row_count: p.rows.length, note, uploaded_by: email, due_at: dueAt, assigned_to: assignedTo,
  }).select("id").single();
  return error ? null : (data as any).id as string;
}

export async function uploadList(storeId: string, _: Result, f: FormData): Promise<Result> {
  const user = await member(storeId);
  if (!user) return { error: "You don't have access to this store." };
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  const campaignId = text(f, "campaign_id", 64);
  if (campaignId && !(await campaignInStore(storeId, campaignId))) return { error: "Choose a campaign from this store." };
  const p = await readCsv(file);
  if (typeof p === "string") return { error: p };
  const store = await storeInfo(storeId);
  const due = readDue(f, store.tz);
  if (typeof due === "string") return { error: due };
  // Store logins set a deadline; only managers and admins hand the sheet to an agent.
  const assignedTo = atLeast(user.role, "manager") ? readAgent(f) : null;
  const listId = await saveList(storeId, campaignId, file.name, p, text(f, "note", 1000), user.email, due.at, assignedTo);
  if (!listId) return { error: "Couldn't save this list." };
  let campaign: string | null = null;
  if (campaignId) campaign = ((await db().from("campaigns").select("name").eq("id", campaignId).maybeSingle()).data as any)?.name ?? null;
  const by = { email: user.email, name: user.name, dealership: user.role === "dealership" };
  await notifyListUpload({ storeId, storeName: store.name, listId, fileName: file.name, rows: p.rows.length, campaign, dueText: due.text, by }).catch(() => undefined);
  if (assignedTo) await notifyAssigned({ userId: assignedTo, storeId, storeName: store.name, what: `Calling sheet: ${file.name} (${p.rows.length.toLocaleString()} customers)`, dueText: due.text, link: `/command?d=${storeId}&tab=lists`, by }).catch(() => undefined);
  refresh();
  return { ok: true };
}

// Change who works a calling sheet and when it's due.
export async function setListTask(storeId: string, listId: string, _: Result, f: FormData): Promise<Result> {
  const user = await staff(storeId);
  if (!user || !UUID.test(listId)) return { error: "You don't have access to this." };
  const client = db();
  const before = (await client.from("outbound_lists").select("file_name,row_count,assigned_to,due_at").eq("id", listId).eq("dealership_id", storeId).maybeSingle()).data as any;
  if (!before) return { error: "This list no longer exists." };
  const store = await storeInfo(storeId);
  const due = readDue(f, store.tz);
  if (typeof due === "string") return { error: due };
  const assignedTo = readAgent(f);
  const { error } = await client.from("outbound_lists").update({ due_at: due.at, assigned_to: assignedTo }).eq("id", listId);
  if (error) return { error: "Couldn't save." };
  if (assignedTo && (assignedTo !== before.assigned_to || !sameTime(due.at, before.due_at))) {
    await notifyAssigned({ userId: assignedTo, storeId, storeName: store.name, what: `Calling sheet: ${before.file_name} (${Number(before.row_count).toLocaleString()} customers)`, dueText: due.text, link: `/command?d=${storeId}&tab=lists`, by: user }).catch(() => undefined);
  }
  refresh();
  return { ok: true };
}

export async function deleteList(storeId: string, id: string) {
  const user = await staff(storeId);
  if (!user || !UUID.test(id)) return;
  await db().from("outbound_lists").delete().eq("id", id).eq("dealership_id", storeId);
  refresh();
}
