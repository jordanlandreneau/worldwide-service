import "server-only";
import { db } from "@/lib/data";
import { escapeHtml, sendMail } from "@/lib/mail";
import { SITE_URL } from "@/lib/site";
import { isServiceTeam } from "@/lib/access";

export type Assigned = { id: string; kind: "user" | "team"; refId: string; name: string; dueAt: string | null; note: string | null };
export type Agent = { id: string; name: string; email: string; team: string | null };

// Agents and managers on a Service team: the people work can be handed to.
export async function serviceAgents(): Promise<Agent[]> {
  const { data } = await db().from("app_users").select("id,first_name,last_name,email,team_name,role,status").in("role", ["agent", "manager", "admin"]).neq("status", "disabled");
  return ((data ?? []) as any[])
    .filter((x) => isServiceTeam(x.team_name))
    .map((x) => ({ id: x.id, email: String(x.email).toLowerCase(), team: x.team_name ?? null, name: [x.first_name, x.last_name].filter(Boolean).join(" ") || x.email }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Who works a store: agents assigned directly, plus whole teams.
export async function assignmentsFor(storeId: string): Promise<Assigned[]> {
  const client = db();
  const { data } = await client.from("store_assignments").select("id,user_id,team_id,due_at,note").eq("dealership_id", storeId);
  const rows = (data ?? []) as any[];
  const userIds = rows.filter((r) => r.user_id).map((r) => r.user_id);
  const teamIds = rows.filter((r) => r.team_id).map((r) => r.team_id);
  const [{ data: users }, { data: teams }] = await Promise.all([
    userIds.length ? client.from("app_users").select("id,first_name,last_name,email").in("id", userIds) : Promise.resolve({ data: [] }),
    teamIds.length ? client.from("teams").select("id,name").in("id", teamIds) : Promise.resolve({ data: [] }),
  ]);
  const u = new Map(((users ?? []) as any[]).map((x) => [x.id, [x.first_name, x.last_name].filter(Boolean).join(" ") || x.email]));
  const t = new Map(((teams ?? []) as any[]).map((x) => [x.id, x.name]));
  return rows.map((r) => r.user_id
    ? { id: r.id, kind: "user" as const, refId: r.user_id, name: u.get(r.user_id) ?? "Removed user", dueAt: r.due_at, note: r.note }
    : { id: r.id, kind: "team" as const, refId: r.team_id, name: t.get(r.team_id) ?? "Removed team", dueAt: r.due_at, note: r.note })
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "team" ? -1 : 1));
}

// Emails of everyone on a store: direct agents plus active members of assigned teams.
export async function assigneeEmails(storeId: string): Promise<string[]> {
  const client = db();
  const { data } = await client.from("store_assignments").select("user_id,team_id").eq("dealership_id", storeId);
  const rows = (data ?? []) as any[];
  const userIds = rows.filter((r) => r.user_id).map((r) => r.user_id);
  const teamIds = rows.filter((r) => r.team_id).map((r) => r.team_id);
  const out = new Set<string>();
  if (userIds.length) for (const x of ((await client.from("app_users").select("email,status").in("id", userIds)).data ?? []) as any[]) if (x.status !== "disabled") out.add(String(x.email).toLowerCase());
  if (teamIds.length) {
    const names = (((await client.from("teams").select("name").in("id", teamIds)).data ?? []) as any[]).map((x) => x.name);
    if (names.length) for (const x of ((await client.from("app_users").select("email,status").in("team_name", names)).data ?? []) as any[]) if (x.status !== "disabled") out.add(String(x.email).toLowerCase());
  }
  return [...out];
}

// Is this person on the store (directly or through their team)?
export async function storesForUser(userId: string): Promise<Set<string>> {
  const client = db();
  const me = (await client.from("app_users").select("team_name").eq("id", userId).maybeSingle()).data as any;
  const teamId = me?.team_name ? (((await client.from("teams").select("id").eq("name", me.team_name).limit(1)).data ?? []) as any[])[0]?.id ?? null : null;
  let q = client.from("store_assignments").select("dealership_id");
  q = teamId ? q.or(`user_id.eq.${userId},team_id.eq.${teamId}`) : q.eq("user_id", userId);
  const { data } = await q;
  return new Set(((data ?? []) as any[]).map((r) => r.dealership_id));
}

const FALLBACK = () => (process.env.CHANGE_REQUEST_EMAILS ?? "lauren@worldwidebdc.com,leanetm@worldwidebdc.com").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// A calling sheet was uploaded: a popup for the people on the store, and an email to them
// (or to the BDC leads if nobody is assigned yet). The uploader isn't emailed.
export async function notifyListUpload(p: { storeId: string; storeName: string; listId: string; fileName: string; rows: number; campaign: string | null; dueText: string | null; by: { email: string; name: string; dealership: boolean } }) {
  const client = db();
  const link = `/command?d=${p.storeId}&tab=lists`;
  const title = `${p.storeName}: new calling sheet`;
  const body = `${p.fileName} · ${p.rows.toLocaleString()} customers${p.campaign ? ` · ${p.campaign}` : ""}${p.dueText ? ` · due ${p.dueText}` : ""} · uploaded by ${p.by.name}`;
  await client.from("site_events").insert({ kind: "list_uploaded", dealership_id: p.storeId, title, body, link, created_by: p.by.email });
  let to = await assigneeEmails(p.storeId);
  if (!to.length) to = FALLBACK();
  to = to.filter((e) => e !== p.by.email.toLowerCase());
  if (!to.length) return;
  await sendMail({
    to, replyTo: p.by.email,
    subject: `${p.storeName} uploaded a calling sheet${p.dueText ? ` (due ${p.dueText})` : ""}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">
      <p><strong>${escapeHtml(p.by.name)}</strong> uploaded a calling sheet for <strong>${escapeHtml(p.storeName)}</strong>.</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:3px 12px 3px 0;color:#6b7280">File</td><td>${escapeHtml(p.fileName)}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#6b7280">Customers</td><td>${p.rows.toLocaleString()}</td></tr>
        ${p.campaign ? `<tr><td style="padding:3px 12px 3px 0;color:#6b7280">Campaign</td><td>${escapeHtml(p.campaign)}</td></tr>` : ""}
        ${p.dueText ? `<tr><td style="padding:3px 12px 3px 0;color:#6b7280">Due</td><td><strong>${escapeHtml(p.dueText)}</strong></td></tr>` : ""}
      </table>
      <p><a href="${SITE_URL}${link}" style="display:inline-block;background:#1f5fbf;color:#fff;padding:9px 16px;border-radius:3px;text-decoration:none">Open the list</a></p>
    </div>`,
  }).catch(() => false);
}

// One agent was handed a piece of work: a popup just for them, and an email.
export async function notifyAssigned(p: { userId: string; storeId: string; storeName: string; what: string; dueText: string | null; link: string; by: { email: string; name: string } }) {
  const client = db();
  const agent = (await client.from("app_users").select("email,first_name,status").eq("id", p.userId).maybeSingle()).data as any;
  if (!agent || agent.status === "disabled") return;
  const title = `${p.storeName}: assigned to you`;
  const body = `${p.what}${p.dueText ? ` · due ${p.dueText}` : ""} · from ${p.by.name}`;
  await client.from("site_events").insert({ kind: "assigned", dealership_id: p.storeId, user_id: p.userId, title, body, link: p.link, created_by: p.by.email });
  if (String(agent.email).toLowerCase() === p.by.email.toLowerCase()) return;
  await sendMail({
    to: [agent.email], replyTo: p.by.email,
    subject: `Assigned to you: ${p.storeName}${p.dueText ? ` (due ${p.dueText})` : ""}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">
      <p>Hi ${escapeHtml(agent.first_name ?? "")}, <strong>${escapeHtml(p.by.name)}</strong> assigned you work for <strong>${escapeHtml(p.storeName)}</strong>.</p>
      <p>${escapeHtml(p.what)}</p>
      ${p.dueText ? `<p>Due: <strong>${escapeHtml(p.dueText)}</strong></p>` : ""}
      <p><a href="${SITE_URL}${p.link}" style="display:inline-block;background:#1f5fbf;color:#fff;padding:9px 16px;border-radius:3px;text-decoration:none">Open it</a></p>
    </div>`,
  }).catch(() => false);
}
