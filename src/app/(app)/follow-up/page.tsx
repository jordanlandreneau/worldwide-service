import { cookies } from "next/headers";
import Link from "next/link";
import { AtSign, BarChart3, Bell, Building2, LayoutDashboard, LogOut, MessageSquareText, MessagesSquare, Reply, Search, Users } from "lucide-react";
import { ActionButton, Field, ModalForm } from "@/components/action-form";
import { CopyButton, ThemeToggle } from "@/components/follow-bits";
import { Composer } from "@/components/follow-composer";
import { ChatFields } from "@/components/follow-chat-fields";
import { atLeast, requireUser } from "@/lib/access";
import { db, fetchAll } from "@/lib/data";
import { acknowledge, addMember, bulkAddMembers, deleteChat, markRead, noReplyNeeded, removeMember, reopen, saveChat, setAlerts, sendFollowUp, sendReply, setMemberEmail, syncGoogleChat, syncWhatsAppNames } from "@/lib/follow";
import { CHANNELS, channelReady } from "@/lib/follow-send";
import { googleAccount, googleSpaceMembers, googleSpaces, googleUserConfigured, slackChannels, slackConfigured, teamsMembers, teamsAccount, teamsConfigured } from "@/lib/follow-providers";
import { alertsFor, myNotifications } from "@/lib/follow-notify";
import { DesktopAlerts } from "@/components/follow-live";
import { JumpTo } from "@/components/follow-jump";

export const metadata = { title: "Follow-ups · Worldwide Service" };

type Channel = keyof typeof CHANNELS;
type Params = { show?: string; teams?: string; google?: string; added?: string; view?: string; channel?: string; chat?: string; tab?: string; q?: string; msg?: string; reply?: string; mention?: string; find?: string; at?: string; mscope?: string; who?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ICON: Record<Channel, string> = { whatsapp: "💬", sms: "📱", slack: "🔔", email: "✉️", teams: "🟣", google_chat: "🗨️" };
const DAY = 24 * 3600 * 1000;
// Each dealership gets its own color (the same one on every channel); managers can pick another in the chat's settings.
const PALETTE = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c", "#0891b2", "#ca8a04", "#db2777", "#4f46e5", "#059669", "#b45309", "#0f766e", "#be123c", "#7c3aed", "#65a30d", "#c2410c"];
const storeKey = (c: any) => c.dealership_id || String(c.name ?? "").split("//")[0].replace(/\b(wwbdc|teams|follow ?up|service|bdc)\b/gi, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
const colorOf = (c: any): string => {
  if (c?.color) return c.color;
  let h = 0;
  for (const ch of storeKey(c)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const HANDLED: Record<string, string> = { answered: "✓ Answered", acknowledged: "👍 Acknowledged", void: "🚫 No reply needed" };

const time = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
const ago = (iso: string | null) => {
  if (!iso) return "no activity";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${Math.max(m, 1)}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

// Search words: up to 5, matched anywhere in the message text or the sender's name.
const words = (s?: string) => (s ?? "").slice(0, 100).replace(/[,()"%_\\*]/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 5);
const reEsc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function Mark({ text, terms }: { text: string; terms: string[] }) {
  if (!text || !terms.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${terms.map(reEsc).join("|")})`, "gi"));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="fu-mark">{p}</mark> : p))}</>;
}
// A slice of a long message centred on the first match.
const snippet = (text: string, terms: string[], len = 170) => {
  const flat = (text ?? "").replace(/\s+/g, " ");
  const at = terms.length ? Math.min(...terms.map((w) => { const i = flat.toLowerCase().indexOf(w.toLowerCase()); return i < 0 ? Infinity : i; })) : 0;
  const start = Number.isFinite(at) && at > 60 ? at - 50 : 0;
  return `${start ? "…" : ""}${flat.slice(start, start + len)}${flat.length > start + len ? "…" : ""}`;
};

// Pictures on a message, shown small; click to open full size.
function Pictures({ list }: { list?: { path: string; type: string; name: string }[] | null }) {
  if (!list?.length) return null;
  return (
    <div className="fu-pics">
      {list.map((a) => a.type.startsWith("image/")
        ? <a key={a.path} href={`/api/follow-up/media?p=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer"><img src={`/api/follow-up/media?p=${encodeURIComponent(a.path)}`} alt={a.name} loading="lazy" /></a>
        : <a key={a.path} className="fu-file" href={`/api/follow-up/media?p=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer">📄 {a.name}</a>)}
    </div>
  );
}

export default async function FollowUps({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser("agent");
  const manager = atLeast(user.role, "manager");
  const sp = await searchParams;
  const theme = (await cookies()).get("fu_theme")?.value === "dark" ? "dark" : "light";
  const roleName = { admin: "Admin", manager: "Manager", agent: "Agent", dealership: "Store" }[user.role];
  const initials = user.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const view = sp.view === "manage" || sp.view === "analytics" || sp.view === "alerts" ? sp.view : "dashboard";
  const client = db();
  // New replies are pulled in the background by <LiveSync />, so the page doesn't wait on the chat apps.
  // Everything the page needs is read at once.
  const [teams, google, myGoogle, chats, stores, { data: unreadRows }, { data: memberRows }, { data: meRow }, notes] = await Promise.all([
    teamsConfigured() ? teamsAccount().catch(() => null) : Promise.resolve(null),
    googleUserConfigured() ? googleAccount().catch(() => null) : Promise.resolve(null),
    googleUserConfigured() ? googleAccount(user.email).catch(() => null) : Promise.resolve(null),
    fetchAll<any>("follow_chats", "id,name,channel,dealership_id,active,last_activity,whatsapp_group_id,teams_chat_id,google_chat_space,justcall_line,justcall_group_id,slack_channel_id,color", "name"),
    fetchAll<any>("dealerships", "id,name,active", "name"),
    // "Pending" means store messages nobody has answered or acknowledged yet.
    client.from("follow_messages").select("chat_id").eq("direction", "inbound").is("handled_kind", null).limit(5000),
    client.from("follow_members").select("id,chat_id,name,phone,email,role").order("name").limit(10000),
    client.from("app_users").select("follow_alerts").ilike("email", user.email.replace(/[%_\\]/g, "\\$&")).maybeSingle(),
    // Store messages that answer this person's follow-ups (or @-mention them): the Notifications tab.
    myNotifications(user.email, { unclaimedToo: manager }),
  ]);
  const alerts = alertsFor(user.role, (meRow as any)?.follow_alerts);
  const waiting = notes.mine.filter((m: any) => !m.handled_kind);
  const unread = new Map<string, number>();
  for (const r of (unreadRows ?? []) as any[]) unread.set(r.chat_id, (unread.get(r.chat_id) ?? 0) + 1);
  const members = new Map<string, any[]>();
  for (const m of (memberRows ?? []) as any[]) members.set(m.chat_id, [...(members.get(m.chat_id) ?? []), m]);
  const status = (c: any) => (unread.get(c.id) ? "pending" : c.last_activity && Date.now() - new Date(c.last_activity).getTime() < DAY ? "active" : "inactive");
  const channels = Object.keys(CHANNELS) as Channel[];
  const selected = sp.chat && UUID.test(sp.chat) ? chats.find((c: any) => c.id === sp.chat) : undefined;
  // All dealerships are one list; a channel is only an optional filter.
  const chFilter = channels.includes(sp.channel as Channel) ? (sp.channel as Channel) : null;
  const channel = (chFilter ?? selected?.channel ?? null) as Channel | null;
  // The connected Google account's spaces and the Slack channels the app is in, for the chat settings lists.
  const [spaceList, slackList] = manager ? await Promise.all([google ? googleSpaces().catch(() => []) : [], slackConfigured() ? slackChannels().catch(() => []) : []]) : [[], []];
  const activeStores = stores.filter((s: any) => s.active !== false).map((s: any) => ({ id: s.id as string, name: s.name as string }));
  const link = (p: Params) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ view: undefined, channel: chFilter ?? undefined, ...p })) if (v) q.set(k, v);
    return `/follow-up?${q}`;
  };

  return (
    <div className="fu-app" data-theme={theme}>
      <aside className="fu-side">
        <div className="fu-side-head">
          <span className="fu-logo"><MessagesSquare size={18} /></span>
          <div><strong>Service BDC Portal</strong><span>Follow-ups</span></div>
          <ThemeToggle initial={theme} />
        </div>
        <nav className="fu-nav" aria-label="Follow-up pages">
          <Link href={link({})} className={view === "dashboard" ? "active" : ""}><LayoutDashboard size={16} /> Dashboard</Link>
          <Link href={link({ view: "manage" })} className={view === "manage" ? "active" : ""}><Building2 size={16} /> Dealership Management</Link>
          <Link href={link({ view: "alerts" })} className={view === "alerts" ? "active" : ""}><Bell size={16} /> My notifications{waiting.length ? <b className="fu-count">{waiting.length}</b> : null}</Link>
          <Link href={link({ view: "analytics" })} className={view === "analytics" ? "active" : ""}><BarChart3 size={16} /> Analytics</Link>
        </nav>
        <p className="fu-side-label">Channels <small>(filter)</small></p>
        <div className="fu-channels">
          <Link href={`/follow-up?${new URLSearchParams(view === "dashboard" ? {} : { view })}`} className={!chFilter ? "active" : ""} title="All channels">
            <span aria-hidden>🗂️</span><span className="fu-ch-name">All channels</span><i className="on" aria-hidden />
          </Link>
          {channels.map((ch) => (
            <Link key={ch} href={link({ channel: ch, view: view === "dashboard" ? undefined : view })} className={ch === chFilter ? "active" : ""} title={CHANNELS[ch]}>
              <span aria-hidden>{ICON[ch]}</span><span className="fu-ch-name">{CHANNELS[ch]}</span>
              <i className={(ch === "teams" ? !!teams : ch === "google_chat" ? !!google : channelReady(ch)) ? "on" : ""} aria-label={(ch === "teams" ? !!teams : ch === "google_chat" ? !!google : channelReady(ch)) ? "connected" : "not connected"} />
            </Link>
          ))}
        </div>
        {channel === "teams" ? (
          <div className={`fu-conn ${teams ? "on" : ""}`}>
            {!teamsConfigured() ? "Microsoft Teams: keys missing in Vercel" : teams ? <>Microsoft Teams: connected as {teams.name ?? teams.account}</> : "Microsoft Teams: not signed in"}
            {teamsConfigured() && manager && <a className="fu-conn-btn" href="/api/public/microsoft-auth-start">{teams ? "Reconnect Teams" : "Connect Teams"}</a>}
            {sp.teams && <span className="fu-conn-note">{{ connected: "Teams is connected.", failed: "Microsoft didn't accept the sign-in. Check the redirect URI and permissions.", expired: "The sign-in took too long. Try again.", cancelled: "Sign-in was cancelled.", denied: "Only managers can connect Teams.", missing: "Add the Microsoft keys in Vercel first." }[sp.teams] ?? ""}</span>}
          </div>
        ) : channel === "google_chat" ? (
          <div className={`fu-conn ${google ? "on" : ""}`}>
            {!googleUserConfigured() ? "Google Chat: add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel" : google ? <>Google Chat: connected as {google.name ?? google.account}</> : "Google Chat: not signed in"}
            {googleUserConfigured() && manager && <a className="fu-conn-btn" href="/api/public/google-auth-start">{google ? "Reconnect & import spaces" : "Connect Google Chat"}</a>}
            {googleUserConfigured() && google && (myGoogle
              ? <span className="fu-conn-note">Your replies go out as {myGoogle.account}. <a href="/api/public/google-auth-start?mine=1">Switch account</a></span>
              : <a className="fu-conn-btn" href="/api/public/google-auth-start?mine=1">Send as me ({user.email})</a>)}
            {sp.google && <span className="fu-conn-note">{{ mine: "Your Google account is connected. Your Google Chat replies now show your name.", connected: `Google Chat is connected.${sp.added ? ` Added ${sp.added} space${sp.added === "1" ? "" : "s"} as chats.` : ""}`, failed: "Google didn't accept the sign-in. Check the redirect URI and that the Chat API is on.", expired: "The sign-in took too long. Try again.", cancelled: "Sign-in was cancelled.", denied: "Only managers can connect Google Chat.", missing: "Add the Google OAuth keys in Vercel first." }[sp.google] ?? ""}</span>}
          </div>
        ) : channel === "slack" ? (
          <div className={`fu-conn ${slackConfigured() ? "on" : ""}`}>
            {slackConfigured() ? <>Slack: connected · the app is in {slackList.length} channel{slackList.length === 1 ? "" : "s"}</> : "Slack: add SLACK_BOT_TOKEN in Vercel to connect"}
            {slackConfigured() && <span className="fu-conn-note">To add a dealer channel, type <b>/invite @Worldwide Service</b> in it on Slack.</span>}
          </div>
        ) : channel ? (
          <div className={`fu-conn ${channelReady(channel) ? "on" : ""}`}>
            {CHANNELS[channel]}: {channelReady(channel) ? "Connected" : "Not connected yet"}
          </div>
        ) : null}
        {channel !== "teams" && teamsConfigured() && manager && !teams && (
          <div className="fu-conn">
            Microsoft Teams: not signed in
            <a className="fu-conn-btn" href="/api/public/microsoft-auth-start">Connect Teams</a>
          </div>
        )}
        <DesktopAlerts />
        <form action={setAlerts} className="fu-alert-pref">
          <label>Popups for store messages
            <select name="alerts" defaultValue={alerts}>
              <option value="mine">Only mine (my follow-ups, @me)</option>
              <option value="unclaimed">Mine + ones nobody sent</option>
              <option value="all">Every dealership</option>
            </select>
          </label>
          <button>Save</button>
        </form>
        {manager && <Link className="fu-check" href="/follow-up/check">Check connections</Link>}
        <div className="fu-user">
          <span className="fu-avatar">{initials}</span>
          <div><strong>{user.name}</strong><span>{roleName}</span></div>
          <form action="/auth/signout" method="post"><button className="fu-icon-btn" aria-label="Sign out" title="Sign out"><LogOut size={15} /></button></form>
        </div>
      </aside>

      {view === "dashboard" && <Dashboard />}
      {view === "manage" && <Manage />}
      {view === "analytics" && <Analytics />}
      {view === "alerts" && <Notifications />}
    </div>
  );

  function Dashboard() {
    const needle = (sp.q ?? "").trim().toLowerCase();
    const list = chats
      .filter((c: any) => (!chFilter || c.channel === chFilter) && (!needle || c.name.toLowerCase().includes(needle)))
      .sort((a: any, b: any) => (unread.get(b.id) ?? 0) - (unread.get(a.id) ?? 0) || String(b.last_activity ?? "").localeCompare(String(a.last_activity ?? "")));
    return (
      <>
        <section className="fu-list" aria-label="Dealerships">
          <div className="fu-list-head">
            <h1>Dealerships</h1>
            <p>{list.length} dealership chat{list.length === 1 ? "" : "s"}{chFilter ? ` on ${CHANNELS[chFilter]}` : " on every channel"} · click one to open it</p>
            <form className="fu-search">
              {chFilter && <input type="hidden" name="channel" value={chFilter} />}
              <Search size={15} aria-hidden />
              <input name="q" defaultValue={sp.q ?? ""} placeholder="Filter dealerships…" aria-label="Filter dealerships" />
            </form>
            <form className="fu-search">
              {chFilter && <input type="hidden" name="channel" value={chFilter} />}
              <MessageSquareText size={15} aria-hidden />
              <input name="msg" defaultValue={sp.msg ?? ""} placeholder="Search messages or who sent them…" aria-label="Search messages" />
              {sp.mscope === "here" && <input type="hidden" name="mscope" value="here" />}
            </form>
            {manager && (
              <ModalForm button="+ Add dealership chat" title="New chat" note="Add a store's follow-up chat. The id comes from the chat app." action={saveChat.bind(null, null)} submit="Add chat">
                <ChatFields chat={{ channel: channel ?? "whatsapp", active: true }} stores={activeStores} spaces={spaceList} slackChannels={slackList} />
              </ModalForm>
            )}
          </div>
          {sp.msg?.trim() ? <MessageResults /> : <ul className="fu-items">
            {list.length === 0 && <li className="fu-muted fu-pad">No {chFilter ? CHANNELS[chFilter] : "dealership"} chats{needle ? " match" : " yet"}.</li>}
            {list.map((c: any) => {
              const st = status(c);
              return (
                <li key={c.id}>
                  <Link href={link({ chat: c.id, q: sp.q })} className={`fu-item${selected?.id === c.id ? " active" : ""}`} style={{ ["--dc" as string]: colorOf(c) }}>
                    <span className="fu-item-top"><span className="fu-ch-ico" title={CHANNELS[c.channel as Channel]} aria-label={CHANNELS[c.channel as Channel]}>{ICON[c.channel as Channel]}</span><strong>{c.name}</strong>{unread.get(c.id) ? <b className="fu-count">{unread.get(c.id)}</b> : null}<em className={`fu-badge ${st}`}>{st === "pending" ? "Pending" : st === "active" ? "Active" : "Inactive"}</em></span>
                    <span className="fu-item-sub"><Users size={12} aria-hidden /> {(members.get(c.id) ?? []).length} members · {ago(c.last_activity)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>}
        </section>
        <section className="fu-detail" aria-label="Chat">{selected ? <ChatPanel chat={selected} /> : <EmptyDetail />}</section>
      </>
    );
  }

  async function MessageResults() {
    const terms = words(sp.msg);
    const here = sp.mscope === "here" && !!chFilter;
    let q = client.from("follow_messages").select("id,chat_id,body,direction,sender_name,sender,created_at,attachments");
    for (const w of terms) q = q.or(`body.ilike.%${w}%,sender_name.ilike.%${w}%,sender.ilike.%${w}%`);
    if (here) q = q.in("chat_id", chats.filter((c: any) => c.channel === chFilter).map((c: any) => c.id));
    const { data } = terms.length ? await q.order("created_at", { ascending: false }).limit(100) : { data: [] };
    const rows = (data ?? []) as any[];
    const byId = new Map(chats.map((c: any) => [c.id, c]));
    return (
      <ul className="fu-items">
        <li className="fu-search-meta">
          <span>{rows.length === 100 ? "Newest 100 matches" : `${rows.length} ${rows.length === 1 ? "match" : "matches"}`}</span>
          {chFilter && <span className="fu-scope">
            <Link href={link({ msg: sp.msg, chat: sp.chat, at: sp.at })} className={!here ? "active" : ""}>All channels</Link>
            <Link href={link({ msg: sp.msg, mscope: "here", chat: sp.chat, at: sp.at })} className={here ? "active" : ""}>{CHANNELS[chFilter]} only</Link>
          </span>}
          <Link href={link({ chat: sp.chat })}>Clear</Link>
        </li>
        {rows.length === 0 && <li className="fu-muted fu-pad">No messages match. Try fewer or shorter words.</li>}
        {rows.map((m) => {
          const c: any = byId.get(m.chat_id);
          const who = m.direction === "inbound" ? m.sender_name || m.sender || "Store" : m.sender_name ? `${m.sender_name} (WWBDC)` : "WWBDC";
          return (
            <li key={m.id}>
              <Link href={`${link({ chat: m.chat_id, msg: sp.msg, mscope: sp.mscope, at: m.id })}#m-${m.id}`} className={`fu-item${sp.at === m.id ? " active" : ""}`} style={{ ["--dc" as string]: c ? colorOf(c) : "transparent" }}>
                <span className="fu-item-top"><strong>{c ? `${ICON[c.channel as Channel] ?? ""} ${c.name}` : "Chat"}</strong><em className={`fu-badge${m.direction === "inbound" ? " pending" : ""}`}>{m.direction === "inbound" ? "Store" : "Sent"}</em></span>
                <span className="fu-item-sub"><Mark text={who} terms={terms} /> · {day(m.created_at)} {time(m.created_at)}</span>
                <span className="fu-snippet">{m.body ? <Mark text={snippet(m.body, terms)} terms={terms} /> : m.attachments?.length ? "📎 Picture" : ""}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  function EmptyDetail() {
    return (
      <div className="fu-empty">
        <span className="fu-empty-icon"><Building2 size={22} /></span>
        <strong>No dealership selected</strong>
        <p>Choose a dealership from the list to see its chat, manage its roster and send follow-ups.</p>
      </div>
    );
  }

  async function ChatPanel({ chat }: { chat: any }) {
    const tab = sp.tab === "roster" ? "roster" : "chat";
    const people = members.get(chat.id) ?? [];
    const store = stores.find((s: any) => s.id === chat.dealership_id);
    const ch = chat.channel as Channel;
    const ident = chat.whatsapp_group_id ?? chat.teams_chat_id ?? chat.google_chat_space ?? (ch === "sms" ? (chat.justcall_group_id ? `JustCall group ${chat.justcall_group_id}` : store ? "Group text starts on the first message" : null) : null) ?? chat.slack_channel_id;
    return (
      <>
        <header className="fu-detail-head">
          <div>
            <h2><i className="fu-dot" style={{ background: colorOf(chat) }} aria-hidden />{chat.name} <em className="fu-pill">{ICON[ch]} {CHANNELS[ch]}</em> <em className={`fu-badge ${status(chat)}`}>{status(chat) === "pending" ? "Pending" : status(chat) === "active" ? "Active" : "Inactive"}</em>{!chat.active && <em className="fu-badge off">Off</em>}</h2>
            <p className="fu-mono fu-muted">{ident ? `id: ${ident}` : "No chat id yet"}{store ? <> · <Link href={`/service/info?d=${store.id}`}>{store.name}</Link></> : null}</p>
          </div>
          <div className="fu-head-actions">
            {ident && <CopyButton value={ident} />}
            {manager && (
              <ModalForm button="Settings" title="Chat settings" action={saveChat.bind(null, chat.id)}>
                <ChatFields chat={{ ...chat, autoColor: colorOf({ ...chat, color: null }) }} stores={stores.filter((s: any) => s.active !== false || s.id === chat.dealership_id)} spaces={spaceList} slackChannels={slackList} />
              </ModalForm>
            )}
            {manager && <ActionButton label="Delete" confirm={`Delete "${chat.name}", its roster and its messages? This can't be undone.`} action={deleteChat.bind(null, chat.id)} />}
          </div>
        </header>
        <div className="fu-tabs" role="tablist">
          <Link role="tab" aria-selected={tab === "chat"} href={link({ chat: chat.id, q: sp.q, msg: sp.msg, mscope: sp.mscope })}><MessagesSquare size={14} /> Chat &amp; Dispatch</Link>
          <Link role="tab" aria-selected={tab === "roster"} href={link({ chat: chat.id, tab: "roster", q: sp.q, msg: sp.msg, mscope: sp.mscope })}><Users size={14} /> Roster</Link>
        </div>
        {tab === "chat" ? <Thread chat={chat} people={people} /> : <Roster chat={chat} people={people} />}
      </>
    );
  }

  async function Thread({ chat, people }: { chat: any; people: any[] }) {
    const cols = "id,direction,body,sender_name,sender,kind,status,error,read,created_at,reply_to,handled_kind,handled_name,handled_at,attachments,customer_name";
    const onlyOpen = sp.show === "open";
    // Three ways to show the chat: the newest messages, every message matching a search
    // in this chat (all history), or the conversation around one message picked from search.
    const findTerms = onlyOpen ? [] : words(sp.find);
    let mode: "latest" | "find" | "at" = "latest";
    let all: any[] = [];
    let hitDay = "";
    if (findTerms.length) {
      mode = "find";
      let q = client.from("follow_messages").select(cols).eq("chat_id", chat.id);
      for (const w of findTerms) q = q.or(`body.ilike.%${w}%,sender_name.ilike.%${w}%,sender.ilike.%${w}%`);
      all = (((await q.order("created_at", { ascending: false }).limit(200)).data ?? []) as any[]).reverse();
    } else if (!onlyOpen && sp.at && UUID.test(sp.at)) {
      const { data: hit } = await client.from("follow_messages").select("created_at").eq("id", sp.at).eq("chat_id", chat.id).maybeSingle();
      if (hit) {
        mode = "at";
        hitDay = day(hit.created_at);
        const [before, after] = await Promise.all([
          client.from("follow_messages").select(cols).eq("chat_id", chat.id).lte("created_at", hit.created_at).order("created_at", { ascending: false }).limit(80),
          client.from("follow_messages").select(cols).eq("chat_id", chat.id).gt("created_at", hit.created_at).order("created_at", { ascending: true }).limit(80),
        ]);
        all = [...((before.data ?? []) as any[]).reverse(), ...((after.data ?? []) as any[])];
      }
    }
    if (mode === "latest") all = ((((await client.from("follow_messages").select(cols).eq("chat_id", chat.id).order("created_at", { ascending: false }).limit(200)).data) ?? []) as any[]).reverse();
    const hl = mode === "find" ? findTerms : mode === "at" ? words(sp.msg) : [];
    const byId = new Map(all.map((m) => [m.id, m]));
    // Our replies sit under the store message they answer, not in the main stream.
    const answers = new Map<string, any[]>();
    for (const m of all) if (m.direction === "outbound" && m.reply_to && byId.has(m.reply_to)) answers.set(m.reply_to, [...(answers.get(m.reply_to) ?? []), m]);
    const open = all.filter((m) => m.direction === "inbound" && !m.handled_kind);
    const openCount = mode === "latest" ? open.length : unread.get(chat.id) ?? 0;
    // "Needs reply" keeps what was handled in the last 3 days (dimmed, with who handled it) under the waiting ones.
    const doneRecently = all.filter((m) => m.direction === "inbound" && m.handled_kind && m.handled_at && Date.now() - Date.parse(m.handled_at) < 3 * DAY).reverse();
    const stream = onlyOpen ? [...open, ...doneRecently] : all.filter((m) => !(m.direction === "outbound" && m.reply_to && byId.has(m.reply_to)));
    const firstDone = onlyOpen ? doneRecently[0]?.id : undefined;
    const followUps = all.filter((m) => m.kind === "follow_up" && m.status !== "failed");
    const lastFollowUp = (m: any) => {
      const t = Date.parse(m.created_at);
      return [...followUps].reverse().find((f) => { const ft = Date.parse(f.created_at); return ft < t && ft > t - 3 * DAY; }) ?? null;
    };
    const pending = all.filter((m) => m.direction === "inbound" && !m.read).length;
    const advisors = people.filter((p) => !/wwbdc|worldwide|service bdc|management/i.test(`${p.name} ${p.email ?? ""}`)).map((p) => p.name as string);
    // @ suggestions: the Roster plus everyone actually in the Teams chat or Google Chat space.
    const live = chat.channel === "teams" && chat.teams_chat_id ? await teamsMembers(chat.teams_chat_id).catch(() => [])
      : chat.channel === "google_chat" && chat.google_chat_space ? (await googleSpaceMembers(chat.google_chat_space).catch(() => [])).filter((p) => p.name).map((p) => ({ name: p.name as string, email: p.email }))
      : [];
    const mentionable = [...people.map((p) => ({ name: p.name as string, email: p.email ?? null, phone: p.phone ?? null })), ...live.map((p) => ({ name: p.name, email: p.email ?? null, phone: null }))]
      .filter((p, i, arr) => p.name && p.name !== "Unnamed" && arr.findIndex((q) => q.name.toLowerCase() === p.name.toLowerCase() || (!!p.email && q.email === p.email)) === i);
    const recipients = chat.channel === "email" ? people.filter((p) => p.email).length : people.length;
    const quoted = sp.reply ? byId.get(sp.reply) : undefined;
    const who = (m: any) => (m.direction === "outbound" ? "WWBDC" : m.sender_name || m.sender || "Store");
    const here = { chat: chat.id, q: sp.q, show: sp.show, msg: sp.msg, mscope: sp.mscope };
    let lastDay = "";
    return (
      <>
        <div className="fu-thread-tools">
          <Link href={link({ ...here, show: undefined })} className={!onlyOpen && mode === "latest" ? "active" : ""}>All messages</Link>
          <Link href={link({ ...here, show: "open" })} className={onlyOpen ? "active" : ""}>Needs reply{openCount ? <b>{openCount}</b> : null}</Link>
          <form className="fu-search fu-find">
            {Object.entries({ channel: chFilter ?? undefined, chat: chat.id, q: sp.q, msg: sp.msg, mscope: sp.mscope }).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
            <Search size={13} aria-hidden />
            <input name="find" defaultValue={mode === "find" ? sp.find : ""} placeholder="Search this chat…" aria-label="Search this chat" />
          </form>
          <span className="fu-legend"><i className="in" /> Store <i className="reply" /> Our reply <i className="out" /> Our message <i className="dispatch" /> Dispatch</span>
          {mode === "latest" && pending > 0 && <form action={markRead.bind(null, chat.id)} className="fu-markread"><button>Mark {pending} as read</button></form>}
        </div>
        {mode === "find" && <div className="fu-found">{all.length === 200 ? "Newest 200" : all.length} {all.length === 1 ? "message" : "messages"} in this chat match “{findTerms.join(" ")}”. Click <b>Show in chat</b> to see one in context. <Link href={link(here)}>Clear search</Link></div>}
        {mode === "at" && <div className="fu-found">Showing the conversation around a message from {hitDay}. <Link href={link(here)}>Back to latest</Link></div>}
        {sp.at && mode === "at" && <JumpTo id={`m-${sp.at}`} />}
        <div className="fu-thread-wrap"><div>
          {mode === "find" && all.length === 0 && <p className="fu-muted fu-pad">Nothing in this chat matches. Try fewer or shorter words.</p>}
          {mode !== "find" && stream.length === 0 && <p className="fu-muted fu-pad">{onlyOpen ? "Nothing waiting, and nothing handled in the last 3 days." : "No messages yet. Sent follow-ups and the store's replies show here."}</p>}
          <ol className="fu-thread">
            {stream.map((m) => {
              const d = day(m.created_at);
              const sep = !onlyOpen && d !== lastDay ? (lastDay = d) : null;
              const kind = m.direction === "inbound" ? "inbound" : m.kind === "follow_up" ? "outbound dispatch" : m.reply_to ? "outbound reply" : "outbound";
              const label = m.direction === "inbound" ? who(m) : m.kind === "follow_up" ? "Follow-up dispatch" : m.reply_to ? "Our reply" : m.kind === "team" ? "In the chat app" : "Our message";
              // The follow-up a store message is answering: the latest one sent in the 3 days before it.
              const answering = m.direction === "inbound" ? lastFollowUp(m) : null;
              const replies = answers.get(m.id) ?? [];
              return (
                <li key={m.id} id={`m-${m.id}`} className="fu-row">
                  {sep && <div className="fu-day">{sep}</div>}
                  {onlyOpen && m.id === firstDone && <div className="fu-day fu-done-head">{open.length ? "Handled in the last 3 days" : "Nothing waiting · handled in the last 3 days"}</div>}
                  {onlyOpen && <div className="fu-day">{day(m.created_at)}</div>}
                  <div className={`fu-bubble ${kind}${onlyOpen && m.handled_kind ? " done" : ""}${sp.at === m.id && mode === "at" ? " fu-hit" : ""}${m.direction === "inbound" && !m.handled_kind ? " open" : ""}${m.direction === "inbound" && !m.read ? " unread" : ""}${m.status === "failed" ? " failed" : ""}`}>
                    <span className="fu-who">{label}{m.direction === "outbound" && <> · <span className="fu-sentby">sent by <b>{m.sender_name ?? "WWBDC"}</b></span></>}</span>
                    {answering && <span className="fu-sentby fu-re">↩ Re: follow-up{answering.customer_name ? ` for ${answering.customer_name}` : ""} sent by <b>{answering.sender_name ?? "WWBDC"}</b></span>}
                    {m.direction === "inbound" && m.sender && m.sender_name && <span className="fu-mono fu-from">{m.sender}</span>}
                    {m.direction === "outbound" && m.reply_to && byId.get(m.reply_to) && <span className="fu-quote">↪ {who(byId.get(m.reply_to))}: {byId.get(m.reply_to).body.slice(0, 80)}</span>}
                    {m.body && <p><Mark text={m.body} terms={hl} /></p>}
                    <Pictures list={m.attachments} />
                    <span className="fu-time">{time(m.created_at)}</span>
                    {mode === "find" && <Link className="fu-incontext" href={`${link({ ...here, at: m.id })}#m-${m.id}`}>Show in chat →</Link>}
                    {m.status === "failed" && <span className="fu-notsent">Not sent{m.error ? `: ${m.error}` : ""}</span>}
                  </div>
                  {m.direction === "inbound" && (
                    <div className="fu-handled">
                      {m.handled_kind ? (
                        <span className={`fu-state ${m.handled_kind}`}>{HANDLED[m.handled_kind] ?? m.handled_kind} by <b>{m.handled_name ?? "BDC"}</b> · {day(m.handled_at) === day(new Date().toISOString()) ? time(m.handled_at) : `${day(m.handled_at)} ${time(m.handled_at)}`}</span>
                      ) : <span className="fu-state open">Needs reply</span>}
                      <Link href={link({ ...here, reply: m.id })}><Reply size={12} /> Reply</Link>
                      {!m.handled_kind && <form action={acknowledge.bind(null, chat.id, m.id)}><button>👍 Acknowledge</button></form>}
                      {!m.handled_kind && <form action={noReplyNeeded.bind(null, chat.id, m.id)}><button title="Nothing to answer (e.g. “Thanks!”). Records your name.">🚫 No reply needed</button></form>}
                      {m.handled_kind && <form action={reopen.bind(null, chat.id, m.id)}><button>Reopen</button></form>}
                    </div>
                  )}
                  {replies.length > 0 && (
                    <ul className="fu-answers">
                      {replies.map((r) => (
                        <li key={r.id} id={`m-${r.id}`} className={`fu-bubble outbound reply${sp.at === r.id && mode === "at" ? " fu-hit" : ""}${r.status === "failed" ? " failed" : ""}`}>
                          <span className="fu-who">Our reply · <span className="fu-sentby">sent by <b>{r.sender_name ?? "WWBDC"}</b></span></span>
                          {r.body && <p><Mark text={r.body} terms={hl} /></p>}
                          <Pictures list={r.attachments} />
                          <span className="fu-time">{time(r.created_at)}</span>
                          {r.status === "failed" && <span className="fu-notsent">Not sent{r.error ? `: ${r.error}` : ""}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </div></div>
        <Composer key={`${chat.id}-${sp.reply ?? ""}-${sp.mention ?? ""}`} chatId={chat.id}
          initialText={sp.mention ? `@${sp.mention.slice(0, 80)} ` : ""}
          replyTo={quoted && quoted.direction === "inbound" ? { id: quoted.id, who: who(quoted), text: quoted.body.replace(/\s+/g, " ").slice(0, 120), cancelHref: link(here) } : undefined}
          channel={CHANNELS[chat.channel as Channel]} recipients={recipients} advisors={advisors} people={mentionable} sendMessage={sendReply.bind(null, chat.id)} sendDispatch={sendFollowUp.bind(null, chat.id)} />
      </>
    );
  }

  function Roster({ chat, people }: { chat: any; people: any[] }) {
    return (
      <div className="fu-roster">
        <p className="fu-eyebrow">Roster · {people.length} {people.length === 1 ? "member" : "members"}</p>
        {manager && (
          <div className="fu-roster-tools">
            <ModalForm button="+ Add member" title="Add a member" note="Email chats send to everyone with an email here." action={addMember.bind(null, chat.id)} submit="Add">
              <Field label="Name (optional)"><input className="x-input" name="name" defaultValue="" placeholder="Name" /></Field>
              <Field label="Phone"><input className="x-input" name="phone" type="tel" placeholder="12223334444" /></Field>
              <Field label="Email"><input className="x-input" name="email" type="email" /></Field>
            </ModalForm>
            <ModalForm button="+ Bulk add (paste multiple)" title="Bulk add" note="One person per line: name, phone, email. Phone or email can be left out." action={bulkAddMembers.bind(null, chat.id)} submit="Add everyone">
              <Field label="People"><textarea className="x-input" name="lines" rows={8} placeholder={"Jane Smith, 3055551234, jane@store.com\nMike Lee, 7865550000"} /></Field>
            </ModalForm>
            {chat.channel === "whatsapp" && (
              <ModalForm button="Sync names from WhatsApp" title="Sync names from WhatsApp" note="Renames people on this roster to the names they use in the WhatsApp group, matched by phone number." action={syncWhatsAppNames.bind(null, chat.id)} submit="Sync names">
                <span />
              </ModalForm>
            )}
            {chat.channel === "google_chat" && chat.google_chat_space && (
              <ModalForm button="Sync from Google Chat" title="Sync from Google Chat" note="Brings over the last 30 days of messages and adds everyone in the Google Chat space to this Roster (with their name and email where the company directory has them)." action={syncGoogleChat.bind(null, chat.id)} submit="Sync now">
                <span />
              </ModalForm>
            )}
          </div>
        )}
        {people.length === 0 && <p className="fu-muted">No members yet.</p>}
        <ul className="fu-people">
          {people.map((p) => (
            <li key={p.id}>
              <div><strong>{p.name}</strong><span className="fu-mono fu-muted">{p.phone ?? ""}</span></div>
              <span className="fu-email">
                <span className={p.email ? "" : "fu-muted"}>{p.email ?? "No email"}</span>
                {manager && (
                  <ModalForm button={p.email ? "Edit email" : "+ Email"} title={`Email for ${p.name}`} action={setMemberEmail.bind(null, chat.id, p.id)}>
                    <Field label="Email"><input className="x-input" name="email" type="email" defaultValue={p.email ?? ""} /></Field>
                  </ModalForm>
                )}
              </span>
              <span className="fu-row-actions">
                <Link className="fu-mention" href={link({ chat: chat.id, mention: p.name, q: sp.q })}><AtSign size={12} /> Mention</Link>
                {manager && <ActionButton label="Remove" confirm={`Remove ${p.name} from this roster?`} action={removeMember.bind(null, chat.id, p.id)} />}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  function Manage() {
    const needle = (sp.q ?? "").trim().toLowerCase();
    const list = chats.filter((c: any) => !needle || c.name.toLowerCase().includes(needle));
    return (
      <section className="fu-page">
        <h1>Dealership Management</h1>
        <p className="fu-muted">All dealer chats and their rosters in one place.</p>
        <form className="fu-search fu-search-wide"><input type="hidden" name="view" value="manage" /><Search size={15} aria-hidden /><input name="q" defaultValue={sp.q ?? ""} placeholder="Search dealerships…" aria-label="Search dealerships" /></form>
        {list.map((c: any) => {
          const people = members.get(c.id) ?? [];
          return (
            <details key={c.id} className="fu-card">
              <summary>
                <i className="fu-dot" style={{ background: colorOf(c) }} aria-hidden /><strong>{c.name}</strong> <em className={`fu-badge ${status(c)}`}>{status(c) === "pending" ? "Pending" : status(c) === "active" ? "Active" : "Inactive"}</em>
                <span className="fu-muted"> · {people.length} members</span>
                <span className="fu-pill">{ICON[c.channel as Channel]} {CHANNELS[c.channel as Channel]}</span>
                <Link className="fu-open" href={link({ chat: c.id })}>Open</Link>
              </summary>
              {people.length === 0 ? <p className="fu-muted fu-pad">No members.</p> : (
                <ul className="fu-people">{people.map((p) => <li key={p.id}><div><strong>{p.name}</strong><span className="fu-mono fu-muted">{p.phone ?? ""}</span></div><span className={p.email ? "" : "fu-muted"}>{p.email ?? ""}</span><span /></li>)}</ul>
              )}
            </details>
          );
        })}
      </section>
    );
  }

  // Store messages that are this person's to handle: replies to their follow-ups and messages, and @-mentions.
  function Notifications() {
    const byId = new Map(chats.map((c: any) => [c.id, c]));
    const tab = sp.who === "done" ? "done" : sp.who === "loose" && manager ? "loose" : "mine";
    const done = notes.mine.filter((m: any) => m.handled_kind && m.handled_at && Date.now() - Date.parse(m.handled_at) < 3 * DAY);
    const list = tab === "loose" ? notes.loose : tab === "done" ? done : waiting;
    return (
      <section className="fu-page fu-notes">
        <h1>My notifications</h1>
        <p className="fu-muted">Store messages that answer a follow-up or message you sent here (within 3 days), or that @-mention you. Reply, acknowledge, or mark No reply needed. Your name is recorded either way.</p>
        <div className="fu-thread-tools">
          <Link href={link({ view: "alerts" })} className={tab === "mine" ? "active" : ""}>Waiting on me{waiting.length ? <b>{waiting.length}</b> : null}</Link>
          <Link href={link({ view: "alerts", who: "done" })} className={tab === "done" ? "active" : ""}>Handled (last 3 days)</Link>
          {manager && <Link href={link({ view: "alerts", who: "loose" })} className={tab === "loose" ? "active" : ""}>Nobody&apos;s yet{notes.loose.length ? <b>{notes.loose.length}</b> : null}</Link>}
        </div>
        {list.length === 0 && <p className="fu-muted fu-pad">{tab === "mine" ? "Nothing waiting on you. 🎉" : tab === "done" ? "Nothing handled in the last 3 days." : "No unclaimed store messages in the last 14 days."}</p>}
        <ul className="fu-note-list">
          {list.map((m: any) => {
            const c: any = byId.get(m.chat_id);
            const cl = notes.claims.get(m.id);
            const why = cl?.mentioned.has(user.email.toLowerCase()) ? "Mentioned you" : cl?.followUp ? `Reply to your follow-up: ${cl.followUp}` : tab === "loose" ? "No one sent a follow-up here in the 3 days before" : "Reply to your message";
            return (
              <li key={m.id} className="fu-note" style={{ ["--dc" as string]: c ? colorOf(c) : "#94a3b8" }}>
                <div className="fu-note-top">
                  <strong>{c ? <>{ICON[c.channel as Channel]} {c.name}</> : "Chat"}</strong>
                  <span className="fu-muted">{m.sender_name || m.sender || "Store"} · {day(m.created_at)} {time(m.created_at)}</span>
                </div>
                <p className="fu-note-why">{why}{cl?.followUpBy && <> · sent by <b>{cl.followUpBy}</b></>}</p>
                {m.body && <p className="fu-note-body">{m.body.slice(0, 600)}</p>}
                <Pictures list={m.attachments} />
                <div className="fu-handled">
                  {m.handled_kind
                    ? <span className={`fu-state ${m.handled_kind}`}>{HANDLED[m.handled_kind] ?? m.handled_kind} by <b>{m.handled_name ?? "BDC"}</b> · {time(m.handled_at)}</span>
                    : <span className="fu-state open">Needs reply</span>}
                  <Link href={`${link({ chat: m.chat_id, at: m.id })}#m-${m.id}`}>Open chat</Link>
                  {!m.handled_kind && <Link href={link({ chat: m.chat_id, show: "open", reply: m.id })}><Reply size={12} /> Reply</Link>}
                  {!m.handled_kind && <form action={acknowledge.bind(null, m.chat_id, m.id)}><button>👍 Acknowledge</button></form>}
                  {!m.handled_kind && <form action={noReplyNeeded.bind(null, m.chat_id, m.id)}><button>🚫 No reply needed</button></form>}
                  {m.handled_kind && <form action={reopen.bind(null, m.chat_id, m.id)}><button>Reopen</button></form>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  async function Analytics() {
    // Who handled store messages in the last 7 days, and how.
    const { data: handled } = await client.from("follow_messages").select("handled_name,handled_kind").eq("direction", "inbound").not("handled_kind", "is", null)
      .gte("handled_at", new Date(Date.now() - 7 * DAY).toISOString()).limit(10000);
    const byAgent = new Map<string, { answered: number; acknowledged: number; void: number }>();
    for (const h of (handled ?? []) as any[]) {
      const k = h.handled_name || "Unknown";
      const t = byAgent.get(k) ?? { answered: 0, acknowledged: 0, void: 0 };
      t[h.handled_kind as "answered"] = (t[h.handled_kind as "answered"] ?? 0) + 1;
      byAgent.set(k, t);
    }
    const agentRows = [...byAgent.entries()].sort((a, b) => (b[1].answered + b[1].acknowledged + b[1].void) - (a[1].answered + a[1].acknowledged + a[1].void));
    const total = chats.length;
    const people = (memberRows ?? []).length;
    const counts = { active: 0, pending: 0, inactive: 0 } as Record<string, number>;
    for (const c of chats) counts[status(c)]++;
    const top = [...chats].sort((a: any, b: any) => (members.get(b.id) ?? []).length - (members.get(a.id) ?? []).length).slice(0, 5);
    return (
      <section className="fu-page">
        <h1>Analytics</h1>
        <p className="fu-muted">Engagement across all dealer chats.</p>
        <div className="fu-stats">
          <div><span>Dealer chats</span><strong>{total}</strong></div>
          <div><span>Total members</span><strong>{people}</strong></div>
          <div><span>Avg / chat</span><strong>{total ? (people / total).toFixed(1) : 0}</strong></div>
          <div><span>Active (24h)</span><strong className="fu-green">{counts.active}</strong></div>
        </div>
        <div className="fu-card fu-pad">
          <p className="fu-eyebrow">Engagement breakdown</p>
          {(["active", "pending", "inactive"] as const).map((k) => (
            <div key={k} className="fu-bar">
              <span>{k === "active" ? "Active" : k === "pending" ? "Pending replies" : "Inactive"}</span><span className="fu-muted">{counts[k]} ({total ? Math.round((counts[k] / total) * 100) : 0}%)</span>
              <i><b className={k} style={{ width: `${total ? (counts[k] / total) * 100 : 0}%` }} /></i>
            </div>
          ))}
        </div>
        <div className="fu-card fu-pad">
          <p className="fu-eyebrow">Store messages handled · last 7 days (acknowledged counts as replied)</p>
          {agentRows.length === 0 ? <p className="fu-muted">Nothing handled in the last 7 days.</p> : (
            <table className="fu-table">
              <thead><tr><th>Agent</th><th>Replied</th><th>Acknowledged</th><th>No reply needed</th><th>Total handled</th></tr></thead>
              <tbody>{agentRows.map(([n, t]) => <tr key={n}><td>{n}</td><td>{t.answered}</td><td>{t.acknowledged}</td><td>{t.void}</td><td><strong>{t.answered + t.acknowledged + t.void}</strong></td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div className="fu-card fu-pad">
          <p className="fu-eyebrow">Top dealer chats by roster size</p>
          <ul className="fu-people">{top.map((c: any) => <li key={c.id}><div><strong>{c.name}</strong></div><span className="fu-muted">{(members.get(c.id) ?? []).length} members · {ago(c.last_activity)}</span><span /></li>)}</ul>
        </div>
        <div className="fu-card fu-pad">
          <p className="fu-eyebrow">By channel</p>
          <ul className="fu-people">{channels.map((ch) => <li key={ch}><div><strong>{ICON[ch]} {CHANNELS[ch]}</strong></div><span className="fu-muted">{chats.filter((c: any) => c.channel === ch).length} chats</span><span /></li>)}</ul>
        </div>
      </section>
    );
  }
}

