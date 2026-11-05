"use server";
import { SITE_URL } from "@/lib/site";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/data";
import { createAuthClient } from "@/lib/supabase-auth";

const ROLES = ["agent", "manager", "admin", "dealership"];
export type FormState = { error?: string; notice?: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const site = () => SITE_URL;
const likeSafe = (v: string) => v.replace(/[\\%_]/g, "\\$&");

async function sendEmail(to: string, subject: string, heading: string, body: string, link: string, action: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.INVITE_EMAIL_FROM;
  if (!key || !from) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [to], subject,
      html: `<p style="font-size:18px;font-weight:600">${esc(heading)}</p><p>${esc(body)}</p><p><a href="${esc(link)}">${esc(action)}</a></p>`,
    }),
  });
  return res.ok;
}

// The link opens a page with a button, so email scanners can't use up the one-time token.
async function makeLink(email: string, kind: "invite" | "recovery") {
  const auth = db().auth.admin;
  let result = await auth.generateLink({ type: kind, email, options: { redirectTo: `${site()}/auth/set-password` } } as any);
  let type: string = kind;
  // Someone who already has a sign-in can't be invited again, so use a reset link for them.
  if (result.error && kind === "invite") {
    result = await auth.generateLink({ type: "recovery", email, options: { redirectTo: `${site()}/auth/set-password` } } as any);
    type = "recovery";
  }
  const token = result.data?.properties?.hashed_token;
  if (result.error || !token) return null;
  return { url: `${site()}/auth/accept?token_hash=${encodeURIComponent(token)}&type=${type}`, authUserId: result.data.user?.id ?? null };
}

type Parsed = { first: string; last: string; email: string; role: string; teamId: string | null; stores: string[]; photo: string | null; status: string | null };
function parse(f: FormData): Parsed | string {
  const first = String(f.get("first_name") ?? "").trim();
  const last = String(f.get("last_name") ?? "").trim();
  const email = String(f.get("email") ?? "").trim().toLowerCase();
  const role = String(f.get("role") ?? "");
  const stores = f.getAll("dealerships").map(String);
  const teamId = String(f.get("team_id") ?? "") || null;
  const photo = String(f.get("photo_url") ?? "").trim() || null;
  const status = f.get("status") ? String(f.get("status")) : null;
  if (!first || !last) return "Enter a first and last name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email.";
  if (!ROLES.includes(role)) return "Choose a role.";
  if (role === "dealership" && !stores.length) return "Assign every store this person should see.";
  if (photo && !/^https:\/\//i.test(photo)) return "Photo URL must start with https://";
  if (status && !["invited", "active", "disabled"].includes(status)) return "Choose a status.";
  // Agents and managers sign in only when they're on one of the HR hub's Service teams.
  if ((role === "agent" || role === "manager") && !teamId) return "Choose the person's Service team.";
  return { first, last, email, role, teamId: role === "dealership" ? null : teamId, stores: role === "dealership" ? stores : [], photo, status };
}

async function teamName(id: string | null) {
  if (!id) return null;
  const { data } = await db().from("teams").select("name").eq("id", id).maybeSingle();
  return (data?.name as string | undefined) ?? null;
}

export async function inviteUser(_: FormState, form: FormData): Promise<FormState> {
  const actor = await requireUser("manager");
  const p = parse(form);
  if (typeof p === "string") return { error: p };
  if (p.role === "admin" && actor.role !== "admin") return { error: "Only an admin can invite an admin." };
  const client = db();
  const { data: existing } = await client.from("app_users").select("id").ilike("email", likeSafe(p.email)).maybeSingle();
  if (existing) return { error: "A user with this email already exists." };
  const link = await makeLink(p.email, "invite");
  if (!link) return { error: "Couldn't create the invitation." };
  const { data: row, error } = await client.from("app_users").insert({
    first_name: p.first, last_name: p.last, email: p.email, role: p.role, status: "invited",
    team_id: p.teamId, team_name: await teamName(p.teamId), invited_at: new Date().toISOString(), auth_user_id: link.authUserId,
  }).select("id").single();
  if (error || !row) return { error: "Couldn't save this user." };
  if (p.stores.length) {
    const { error: linkError } = await client.from("user_dealerships").insert(p.stores.map((dealership_id) => ({ user_id: row.id, dealership_id })));
    if (linkError) { await client.from("app_users").delete().eq("id", row.id); return { error: "Couldn't save the stores for this user." }; }
  }
  const sent = await sendEmail(p.email, "You're invited to Worldwide Service", `Hi ${p.first},`, "You've been invited to Worldwide Service. Use this link to set your password.", link.url, "Accept invitation");
  if (!sent) redirect(`/users/${row.id}/edit?notice=not-sent`);
  redirect("/users");
}

export async function saveUser(id: string, _: FormState, form: FormData): Promise<FormState> {
  const actor = await requireUser("manager");
  const p = parse(form);
  if (typeof p === "string") return { error: p };
  const client = db();
  const { data: current } = await client.from("app_users").select("id,role,status,email,auth_user_id").eq("id", id).maybeSingle();
  if (!current) return { error: "This user no longer exists." };
  if (actor.role !== "admin" && (current.role === "admin" || p.role === "admin")) return { error: "Only an admin can change an admin." };
  if (actor.id === id && (p.role !== current.role || (p.status && p.status !== current.status))) return { error: "You can't change your own role or status." };
  if (p.email !== current.email) {
    const { data: taken } = await client.from("app_users").select("id").ilike("email", likeSafe(p.email)).neq("id", id).maybeSingle();
    if (taken) return { error: "A user with this email already exists." };
    if (current.auth_user_id) {
      const { error } = await client.auth.admin.updateUserById(current.auth_user_id as string, { email: p.email, email_confirm: true });
      if (error) return { error: "Couldn't change this user's sign-in email." };
    }
  }
  const { error } = await client.from("app_users").update({
    first_name: p.first, last_name: p.last, email: p.email, photo_url: p.photo, role: p.role, status: p.status ?? current.status,
    team_id: p.teamId, team_name: await teamName(p.teamId), updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return { error: "Couldn't save this user." };
  await client.from("user_dealerships").delete().eq("user_id", id);
  if (p.stores.length) {
    const { error: linkError } = await client.from("user_dealerships").insert(p.stores.map((dealership_id) => ({ user_id: id, dealership_id })));
    if (linkError) return { error: "Saved the profile, but couldn't save the stores. Try again." };
  }
  redirect("/users");
}

export async function resendInvite(id: string, _: FormState): Promise<FormState> {
  await requireUser("manager");
  const client = db();
  const { data: u } = await client.from("app_users").select("email,first_name,status").eq("id", id).maybeSingle();
  if (!u || u.status !== "invited") return { error: "This user isn't waiting on an invitation." };
  const link = await makeLink(u.email as string, "invite");
  if (!link) return { error: "Couldn't create the invitation." };
  const sent = await sendEmail(u.email as string, "You're invited to Worldwide Service", `Hi ${u.first_name},`, "You've been invited to Worldwide Service. Use this link to set your password.", link.url, "Accept invitation");
  if (!sent) return { error: "The email couldn't be sent. Check the email settings." };
  await client.from("app_users").update({ invited_at: new Date().toISOString(), auth_user_id: link.authUserId }).eq("id", id);
  return { notice: "Invitation sent." };
}

// Always gives the same answer, so nobody can use this to find out who has an account.
export async function requestReset(_: FormState, form: FormData): Promise<FormState> {
  const notice = "If that email has an account, a reset link is on its way.";
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { notice };
  const client = db();
  const { data: u } = await client.from("app_users").select("id,first_name,status,recovery_sent_at").ilike("email", likeSafe(email)).maybeSingle();
  if (!u || u.status === "disabled") return { notice };
  if (u.recovery_sent_at && Date.now() - new Date(u.recovery_sent_at as string).getTime() < 300_000) return { notice };
  // 3.0 passwords can't be copied, so people moved from 3.0 get their first sign-in this way.
  let link = await makeLink(email, "recovery");
  if (!link) link = await makeLink(email, "invite");
  if (!link) return { notice };
  await client.from("app_users").update({ recovery_sent_at: new Date().toISOString() }).eq("id", u.id);
  await sendEmail(email, "Reset your Worldwide Service password", `Hi ${u.first_name},`, "Use this link to set a new password.", link.url, "Set password");
  return { notice };
}

export async function acceptLink(form: FormData) {
  const token_hash = String(form.get("token_hash") ?? "");
  const type = String(form.get("type") ?? "") === "invite" ? "invite" : "recovery";
  const supabase = await createAuthClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash, type });
  if (error) redirect("/auth/accept?expired=1");
  redirect("/auth/set-password");
}
