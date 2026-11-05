import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/data";
import { createAuthClient } from "@/lib/supabase-auth";

// Same levels as 3.0. Dealership accounts only get Dashboard, Appointments, Follow-ups, Calls and
// the appointment and follow-up reports on 3.0, and none of those pages exist here yet.
export type Role = "dealership" | "agent" | "manager" | "admin";
export type SessionUser = { id: string | null; email: string; name: string; role: Role };

const DOMAIN = "worldwidebdc.com";
const escapeLike = (v: string) => v.replace(/[\\%_]/g, "\\$&");
const RANK: Record<Role, number> = { dealership: 0, agent: 1, manager: 2, admin: 3 };

async function hrRole(email: string): Promise<Role | null> {
  const url = process.env.HR_SUPABASE_URL;
  const key = process.env.HR_SUPABASE_ANON_KEY;
  const secret = process.env.HR_ACCESS_SECRET;
  if (!url || !key || !secret) return null;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/worldwide_access`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_email: email, p_secret: secret }),
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const role = await res.json();
    return role === "agent" || role === "manager" || role === "admin" ? role : null;
  } catch {
    return null;
  }
}

// The Users page decides access, as on 3.0, whatever the email domain. Company emails that aren't
// listed there fall back to the HR hub. Outside emails must be listed.
export const getUser = cache(async (): Promise<SessionUser | null> => {
  if (process.env.NODE_ENV === "development" && process.env.DEV_USER_ROLE) {
    return { id: null, email: "dev@worldwidebdc.com", name: "Dev User", role: process.env.DEV_USER_ROLE as Role };
  }
  const supabase = await createAuthClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (!email || !data.user?.email_confirmed_at) return null;
  const internal = email.endsWith(`@${DOMAIN}`);
  const bootstrap = (process.env.BOOTSTRAP_ADMIN_EMAILS ?? "").toLowerCase().split(",").map((s) => s.trim());
  const fallbackName = (data.user.user_metadata?.full_name as string | undefined) ?? email;

  const { data: row } = await db().from("app_users").select("id,first_name,last_name,role,status,auth_user_id,last_sign_in_at").ilike("email", escapeLike(email)).maybeSingle();
  if (row) {
    if (row.status === "disabled") return null;
    const stale = !row.last_sign_in_at || Date.now() - new Date(row.last_sign_in_at as string).getTime() > 3_600_000;
    if (row.status === "invited" || row.auth_user_id !== data.user.id || stale) {
      await db().from("app_users").update({ status: "active", auth_user_id: data.user.id, last_sign_in_at: new Date().toISOString() }).eq("id", row.id);
    }
    const name = `${row.first_name} ${row.last_name}`.trim() || fallbackName;
    return { id: row.id as string, email, name, role: bootstrap.includes(email) ? "admin" : (row.role as Role) };
  }
  if (!internal) return null;
  const role = bootstrap.includes(email) ? "admin" : await hrRole(email);
  return role ? { id: null, email, name: fallbackName, role } : null;
});

export async function requireUser(min: Role = "agent"): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/no-access");
  if (user.role === "dealership") redirect("/service/info");
  if (RANK[user.role] < RANK[min]) redirect("/service/info");
  return user;
}

export const atLeast = (role: Role, min: Role) => RANK[role] >= RANK[min];
