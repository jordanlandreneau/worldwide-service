import "server-only";
import { createCipheriv, createDecipheriv, createHash, createSign, randomBytes } from "node:crypto";
import { db } from "@/lib/data";
import { SITE_URL } from "@/lib/site";

type Sent = { ok: true; externalId?: string } | { ok: false; error: string };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------- Saved connection state (Teams sign-in) ----------
async function getState<T>(name: string): Promise<T | null> {
  const { data } = await db().from("follow_integrations").select("data").eq("name", name).maybeSingle();
  return (data?.data as T) ?? null;
}
async function setState(name: string, value: unknown) {
  await db().from("follow_integrations").upsert({ name, data: value, updated_at: new Date().toISOString() });
}

// Tokens are stored encrypted. The key is MICROSOFT_TOKEN_ENCRYPTION_KEY, or one made from the client secret.
function tokenKey() {
  const base = process.env.MICROSOFT_TOKEN_ENCRYPTION_KEY || process.env.MICROSOFT_CLIENT_SECRET || "";
  return createHash("sha256").update(`follow-ups:${base}`).digest();
}
function seal(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}
function unseal(sealed: string) {
  const b = Buffer.from(sealed, "base64");
  const d = createDecipheriv("aes-256-gcm", tokenKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

// ---------- Linq (text groups) ----------
export const linqReady = () => !!process.env.LINQ_API_TOKEN;
export async function linqSend(groupId: string | null, text: string): Promise<Sent> {
  const token = process.env.LINQ_API_TOKEN;
  if (!token) return { ok: false, error: "Text isn't connected yet: LINQ_API_TOKEN is missing." };
  if (!groupId) return { ok: false, error: "This chat has no Linq group id. Add it in the chat's settings." };
  const url = `https://api.linqapp.com/api/partner/v3/chats/${encodeURIComponent(groupId)}/messages`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const parts = [{ type: "text", value: text }];
  let res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ message: { parts } }) });
  if (res.status === 400 || res.status === 422) res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ parts }) });
  if (!res.ok) return { ok: false, error: `Linq refused the message (${res.status}).` };
  const body = (await res.json().catch(() => ({}))) as any;
  return { ok: true, externalId: body?.message?.id ?? body?.id };
}

// ---------- Microsoft Teams (delegated sign-in of the BDC's Teams account) ----------
type MsTokens = { refresh: string; access?: string; expires?: number; account?: string; name?: string };
export const teamsConfigured = () => !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
export const teamsRedirect = () => process.env.MICROSOFT_REDIRECT_URI || `${SITE_URL}/api/public/microsoft-auth-callback`;
const tenant = () => process.env.MICROSOFT_TENANT_ID || "organizations";
const SCOPES = "offline_access User.Read Chat.ReadWrite ChatMessage.Send";

export function teamsSignInUrl(state: string) {
  const q = new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID ?? "", response_type: "code", redirect_uri: teamsRedirect(), response_mode: "query", scope: SCOPES, state, prompt: "select_account" });
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize?${q}`;
}

async function msToken(params: Record<string, string>) {
  const res = await fetch(`https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID ?? "", client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "", scope: SCOPES, ...params }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !body.access_token) throw new Error(body.error_description || body.error || `token ${res.status}`);
  return body as { access_token: string; refresh_token?: string; expires_in: number };
}

export async function teamsFinishSignIn(code: string) {
  const t = await msToken({ grant_type: "authorization_code", code, redirect_uri: teamsRedirect() });
  const me = (await (await fetch("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${t.access_token}` } })).json().catch(() => ({}))) as any;
  await setState("teams", { refresh: seal(t.refresh_token ?? ""), account: me.userPrincipalName ?? me.mail ?? null, name: me.displayName ?? null, connected_at: new Date().toISOString() });
}

export async function teamsAccount() {
  const s = await getState<MsTokens & { connected_at?: string }>("teams");
  return s?.refresh ? { account: s.account ?? null, name: s.name ?? null } : null;
}

async function teamsAccess(): Promise<string | null> {
  const s = await getState<MsTokens>("teams");
  if (!s?.refresh) return null;
  if (s.access && s.expires && s.expires > Date.now() + 60_000) { try { return unseal(s.access); } catch { /* refresh below */ } }
  const t = await msToken({ grant_type: "refresh_token", refresh_token: unseal(s.refresh) });
  await setState("teams", { ...s, refresh: t.refresh_token ? seal(t.refresh_token) : s.refresh, access: seal(t.access_token), expires: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

export async function teamsSend(chatId: string | null, text: string): Promise<Sent> {
  if (!teamsConfigured()) return { ok: false, error: "Teams isn't set up: the Microsoft keys are missing in Vercel." };
  if (!chatId) return { ok: false, error: "This chat has no Teams chat id. Add it in the chat's settings." };
  const token = await teamsAccess().catch(() => null);
  if (!token) return { ok: false, error: "Teams isn't signed in. A manager needs to click Connect Teams in Follow-ups." };
  const res = await fetch(`https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body: { contentType: "html", content: esc(text).replace(/\n/g, "<br>") } }),
  });
  if (!res.ok) return { ok: false, error: `Teams refused the message (${res.status}).` };
  const body = (await res.json().catch(() => ({}))) as any;
  return { ok: true, externalId: body.id };
}

// Reads recent Teams messages for each Teams chat and saves the store's replies.
export async function teamsPull(chats: { id: string; teams_chat_id: string | null }[], save: (chatId: string, m: { body: string; sender: string | null; senderName: string | null; externalId: string; at: string }) => Promise<void>) {
  const token = await teamsAccess().catch(() => null);
  if (!token) return 0;
  const me = (await getState<MsTokens>("teams"))?.account?.toLowerCase();
  let saved = 0;
  for (const c of chats) {
    if (!c.teams_chat_id) continue;
    const res = await fetch(`https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(c.teams_chat_id)}/messages?$top=20`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) continue;
    const list = ((await res.json().catch(() => ({}))) as any).value ?? [];
    for (const m of list) {
      if (m.messageType !== "message" || m.deletedDateTime) continue;
      const user = m.from?.user;
      if (!user) continue;
      const html = String(m.body?.content ?? "");
      const body = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
      if (!body) continue;
      const fromMe = me && String(user.userPrincipalName ?? "").toLowerCase() === me;
      if (fromMe) continue;
      await save(c.id, { body, sender: user.id ?? null, senderName: user.displayName ?? null, externalId: m.id, at: m.createdDateTime });
      saved++;
    }
  }
  return saved;
}

// ---------- Google Chat (a Chat app using the service account) ----------
export const googleChatReady = () => !!process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON;
let gToken: { value: string; until: number } | null = null;

async function googleAccess() {
  if (gToken && gToken.until > Date.now() + 60_000) return gToken.value;
  const sa = JSON.parse(process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON ?? "{}");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/chat.bot", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(String(sa.private_key ?? "").replace(/\\n/g, "\n")).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!body.access_token) throw new Error("google token");
  gToken = { value: body.access_token, until: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return gToken.value;
}

export async function googleChatSend(space: string | null, text: string): Promise<Sent> {
  if (!googleChatReady()) return { ok: false, error: "Google Chat isn't set up: GOOGLE_CHAT_SERVICE_ACCOUNT_JSON is missing." };
  if (!space || !/^spaces\/[\w-]+$/.test(space)) return { ok: false, error: "This chat has no Google Chat space. Add it in the chat's settings (spaces/…)." };
  const token = await googleAccess().catch(() => null);
  if (!token) return { ok: false, error: "Google didn't accept the Chat service account key." };
  const res = await fetch(`https://chat.googleapis.com/v1/${space}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ text }),
  });
  if (!res.ok) return { ok: false, error: `Google Chat refused the message (${res.status}). The Chat app must be a member of the space.` };
  const body = (await res.json().catch(() => ({}))) as any;
  return { ok: true, externalId: body.name };
}
