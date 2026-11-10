import "server-only";
import { justcall } from "@/lib/justcall";
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

// ---------- Microsoft Teams (delegated sign-in of the BDC's Teams account) ----------
type MsTokens = { refresh: string; access?: string; expires?: number; account?: string; name?: string };
export const teamsConfigured = () => !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
export const teamsRedirect = () => process.env.MICROSOFT_REDIRECT_URI || `${SITE_URL}/api/public/microsoft-auth-callback`;
const tenant = () => process.env.MICROSOFT_TENANT_ID || "organizations";
const SCOPES = "offline_access User.Read Chat.Read ChatMessage.Send";

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

// Reads recent Teams messages for each Teams chat (all chats at once) and hands the store's messages to save.
export type Pulled = { body: string; sender: string | null; senderName: string | null; externalId: string; at: string };
export async function teamsPull(chats: { id: string; teams_chat_id: string | null }[], save: (chatId: string, list: Pulled[]) => Promise<number>) {
  const token = await teamsAccess().catch(() => null);
  if (!token) return 0;
  const me = (await getState<MsTokens>("teams"))?.account?.toLowerCase();
  const counts = await Promise.all(chats.filter((c) => c.teams_chat_id).map(async (c) => {
    try {
      const res = await fetch(`https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(c.teams_chat_id!)}/messages?$top=20`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return 0;
      const list = ((await res.json().catch(() => ({}))) as any).value ?? [];
      const out: Pulled[] = [];
      for (const m of list) {
        if (m.messageType !== "message" || m.deletedDateTime) continue;
        const user = m.from?.user;
        if (!user) continue;
        if (me && String(user.userPrincipalName ?? "").toLowerCase() === me) continue;
        const html = String(m.body?.content ?? "");
        const body = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
        if (body) out.push({ body, sender: user.id ?? null, senderName: user.displayName ?? null, externalId: m.id, at: m.createdDateTime });
      }
      return await save(c.id, out);
    } catch { return 0; }
  }));
  return counts.reduce((a, b) => a + b, 0);
}

// ---------- Google Chat (a Chat app using the service account) ----------
export const googleChatReady = () => !!process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON;
let gToken: { value: string; until: number } | null = null;

async function googleAccess() {
  if (gToken && gToken.until > Date.now() + 60_000) return gToken.value;
  const raw = (process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON ?? "").trim();
  let sa: any;
  try { sa = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")); } catch { throw new Error("GOOGLE_CHAT_SERVICE_ACCOUNT_JSON isn't valid JSON (paste the whole key file, starting with {)"); }
  if (typeof sa === "string") sa = JSON.parse(sa);
  if (!sa.client_email || !sa.private_key) throw new Error("The key file is missing client_email or private_key");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/chat.bot", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  let sig: string;
  try { sig = createSign("RSA-SHA256").update(unsigned).sign(String(sa.private_key ?? "").replace(/\\n/g, "\n")).toString("base64url"); } catch { throw new Error("The private_key in the key file couldn't be read"); }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!body.access_token) throw new Error(`Google refused the key: ${body.error_description ?? body.error ?? res.status}`);
  gToken = { value: body.access_token, until: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return gToken.value;
}

export async function googleChatSend(space: string | null, text: string): Promise<Sent> {
  if (!space || !/^spaces\/[\w-]+$/.test(space)) return { ok: false, error: "This chat has no Google Chat space. Add it in the chat's settings (spaces/…)." };
  // Signed in as the BDC's Google account: send as that person, into any space they're in.
  const user = await googleUserAccess().catch(() => null);
  if (user) {
    const r = await fetch(`https://chat.googleapis.com/v1/${space}/messages`, { method: "POST", headers: { Authorization: `Bearer ${user}`, "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (!r.ok) return { ok: false, error: `Google Chat refused the message (${r.status}). Is the signed-in account a member of this space?` };
    const b = (await r.json().catch(() => ({}))) as any;
    return { ok: true, externalId: b.name };
  }
  if (!googleChatReady()) return { ok: false, error: "Google Chat isn't signed in. A manager needs to click Connect Google Chat in Follow-ups." };
  const token = await googleAccess().catch(() => null);
  if (!token) return { ok: false, error: "Google didn't accept the Chat service account key." };
  const res = await fetch(`https://chat.googleapis.com/v1/${space}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ text }),
  });
  if (!res.ok) return { ok: false, error: `Google Chat refused the message (${res.status}). The Chat app must be a member of the space.` };
  const body = (await res.json().catch(() => ({}))) as any;
  return { ok: true, externalId: body.name };
}

// ---------- Google Chat as the BDC's Google account (like Connect Teams) ----------
// A manager signs in once; Follow-ups then lists the account's spaces, reads every message in them,
// and sends as that account. Needs an OAuth client (GOOGLE_OAUTH_CLIENT_ID / _SECRET) in the same
// Google Cloud project where the Chat API is turned on.
type GTokens = { refresh: string; access?: string; expires?: number; account?: string; name?: string; user?: string };
export const googleUserConfigured = () => !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
export const googleRedirect = () => `${SITE_URL}/api/public/google-auth-callback`;
const G_SCOPES = "openid email profile https://www.googleapis.com/auth/chat.spaces.readonly https://www.googleapis.com/auth/chat.messages";

export function googleSignInUrl(state: string) {
  const q = new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "", response_type: "code", redirect_uri: googleRedirect(), scope: G_SCOPES, state, access_type: "offline", prompt: "consent select_account", hd: "worldwidebdc.com" });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}
async function gUserToken(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "", ...params }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !body.access_token) throw new Error(body.error_description || body.error || `token ${res.status}`);
  return body as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string };
}
export async function googleFinishSignIn(code: string) {
  const t = await gUserToken({ grant_type: "authorization_code", code, redirect_uri: googleRedirect() });
  if (!t.refresh_token) throw new Error("no refresh token");
  const me = (await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` } })).json().catch(() => ({}))) as any;
  await setState("google_chat_user", { refresh: seal(t.refresh_token), access: seal(t.access_token), expires: Date.now() + t.expires_in * 1000, account: me.email ?? null, name: me.name ?? null, user: me.sub ? `users/${me.sub}` : null, connected_at: new Date().toISOString() });
}
export async function googleAccount() {
  const s = await getState<GTokens>("google_chat_user");
  return s?.refresh ? { account: s.account ?? null, name: s.name ?? null } : null;
}
async function googleUserAccess(): Promise<string | null> {
  const s = await getState<GTokens>("google_chat_user");
  if (!s?.refresh || !googleUserConfigured()) return null;
  if (s.access && s.expires && s.expires > Date.now() + 60_000) { try { return unseal(s.access); } catch { /* refresh below */ } }
  const t = await gUserToken({ grant_type: "refresh_token", refresh_token: unseal(s.refresh) });
  await setState("google_chat_user", { ...s, access: seal(t.access_token), expires: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

// Every named space and group chat the signed-in account is in (not 1:1 DMs).
export async function googleSpaces(): Promise<{ name: string; displayName: string }[]> {
  const token = await googleUserAccess();
  if (!token) return [];
  const out: { name: string; displayName: string }[] = [];
  let page = "";
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ pageSize: "1000", ...(page ? { pageToken: page } : {}) });
    const res = await fetch(`https://chat.googleapis.com/v1/spaces?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) break;
    const body = (await res.json().catch(() => ({}))) as any;
    for (const sp of body.spaces ?? []) if (sp.spaceType !== "DIRECT_MESSAGE") out.push({ name: sp.name, displayName: sp.displayName || "Group chat" });
    page = body.nextPageToken ?? "";
    if (!page) break;
  }
  return out;
}

// New messages in each Google Chat chat, except the ones the BDC account sent.
export async function googlePull(chats: { id: string; google_chat_space: string | null }[], since: Date, save: (chatId: string, list: Pulled[]) => Promise<number>) {
  const token = await googleUserAccess().catch(() => null);
  if (!token) return 0;
  const me = (await getState<GTokens>("google_chat_user"))?.user ?? null;
  const counts = await Promise.all(chats.filter((c) => c.google_chat_space && /^spaces\/[\w-]+$/.test(c.google_chat_space)).map(async (c) => {
    try {
      const q = new URLSearchParams({ pageSize: "100", orderBy: "createTime desc", filter: `createTime > "${since.toISOString()}"` });
      const res = await fetch(`https://chat.googleapis.com/v1/${c.google_chat_space}/messages?${q}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return 0;
      const list = (((await res.json().catch(() => ({}))) as any).messages ?? []) as any[];
      const out: Pulled[] = list.reverse()
        .filter((m) => m.sender?.type !== "BOT" && (!me || m.sender?.name !== me) && String(m.text ?? m.formattedText ?? "").trim())
        .map((m) => ({ body: String(m.text ?? "").trim(), sender: m.sender?.name ?? null, senderName: m.sender?.displayName || null, externalId: m.name, at: m.createTime }));
      return await save(c.id, out);
    } catch { return 0; }
  }));
  return counts.reduce((a, b) => a + b, 0);
}

// ---------- Read-only connection checks (nothing is sent) ----------
export type Check = { channel: string; ok: boolean; detail: string };
const status = async (res: Response) => `${res.status}${res.ok ? "" : ` ${(await res.text().catch(() => "")).slice(0, 160)}`}`;

export async function checkConnections(sample: { whatsapp?: string | null; teams?: string | null; space?: string | null }): Promise<Check[]> {
  const out: Check[] = [];
  const run = async (channel: string, fn: () => Promise<{ ok: boolean; detail: string }>) => {
    try { out.push({ channel, ...(await fn()) }); } catch (e) { out.push({ channel, ok: false, detail: e instanceof Error ? e.message : "failed" }); }
  };
  await run("Email (Resend)", async () => {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { ok: false, detail: "RESEND_API_KEY is missing" };
    const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401 && (await res.text()).includes("restricted")) return { ok: true, detail: "Key works (sending-only key)" };
    return { ok: res.ok, detail: res.ok ? "Key works" : `Resend answered ${await status(res)}` };
  });
  await run("WhatsApp (Periskope)", async () => {
    const key = process.env.PERISKOPE_API_KEY ?? process.env.PERISKOPE_API;
    const phone = process.env.PERISKOPE_PHONE;
    if (!key || !phone) return { ok: false, detail: "PERISKOPE_API or PERISKOPE_PHONE is missing" };
    if (!sample.whatsapp) return { ok: false, detail: "No WhatsApp chat with a group id to test against" };
    const res = await fetch(`https://api.periskope.app/v1/chats/${encodeURIComponent(sample.whatsapp)}`, { headers: { Authorization: `Bearer ${key}`, "x-phone": phone } });
    const body = res.ok ? ((await res.json().catch(() => ({}))) as any) : null;
    return { ok: res.ok, detail: res.ok ? `Key works; read group "${body?.chat_name ?? body?.chat?.chat_name ?? sample.whatsapp}"` : `Periskope answered ${await status(res)}` };
  });
  await run("Text (JustCall)", async () => {
    if (!process.env.JUSTCALL_API_KEY || !process.env.JUSTCALL_API_SECRET) return { ok: false, detail: "JUSTCALL_API_KEY or JUSTCALL_API_SECRET is missing" };
    const res = await justcall("/texts?per_page=1", undefined, 0);
    return { ok: res.ok, detail: res.ok ? "Key works; texts go out from each store's JustCall number" : `JustCall answered ${await status(res)}` };
  });
  await run("Microsoft Teams", async () => {
    if (!teamsConfigured()) return { ok: false, detail: "Microsoft keys are missing" };
    const token = await teamsAccess();
    if (!token) return { ok: false, detail: "Not signed in yet: click Connect Teams" };
    const me = await fetch("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${token}` } });
    if (!me.ok) return { ok: false, detail: `Microsoft answered ${await status(me)}` };
    const who = ((await me.json()) as any).userPrincipalName;
    if (!sample.teams) return { ok: true, detail: `Signed in as ${who}` };
    const res = await fetch(`https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(sample.teams)}/messages?$top=1`, { headers: { Authorization: `Bearer ${token}` } });
    return { ok: res.ok, detail: res.ok ? `Signed in as ${who}; can read the dealer chats` : `Signed in as ${who}, but reading a chat failed: ${await status(res)}` };
  });
  await run("Google Chat", async () => {
    if (!googleUserConfigured()) return { ok: false, detail: "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are missing (needed for Connect Google Chat)" };
    const acct = await googleAccount();
    if (!acct) return { ok: false, detail: "Keys are set. A manager needs to click Connect Google Chat in Follow-ups." };
    const spaces = await googleSpaces();
    return { ok: true, detail: `Signed in as ${acct.account}; can see ${spaces.length} spaces` };
  });
  out.push({ channel: "Replies (webhook key)", ok: !!process.env.FOLLOW_UP_WEBHOOK_KEY, detail: process.env.FOLLOW_UP_WEBHOOK_KEY ? "FOLLOW_UP_WEBHOOK_KEY is set" : "FOLLOW_UP_WEBHOOK_KEY is missing, so WhatsApp and text replies are refused" });
  return out;
}
