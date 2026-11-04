"use server";
import { redirect } from "next/navigation";
import { db } from "@/lib/data";
import { createAuthClient } from "@/lib/supabase-auth";

export type FormState = { error?: string; notice?: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const site = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
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

// Always gives the same answer, so nobody can use this to find out who has an account.
export async function requestReset(_: FormState, form: FormData): Promise<FormState> {
  const notice = "If that email has an account, a reset link is on its way.";
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { notice };
  const client = db();
  const { data: u } = await client.from("app_users").select("id,first_name,status,recovery_sent_at").ilike("email", likeSafe(email)).maybeSingle();
  if (!u || u.status === "disabled") return { notice };
  if (u.recovery_sent_at && Date.now() - new Date(u.recovery_sent_at as string).getTime() < 300_000) return { notice };
  // Passwords can't be copied from 4.0, so people copied over set their first password this way.
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
