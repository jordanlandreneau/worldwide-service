import { cookies } from "next/headers";
import Link from "next/link";
import { AtSign, BarChart3, Building2, LayoutDashboard, LogOut, MessageSquareText, MessagesSquare, Reply, Search, Users } from "lucide-react";
import { ActionButton, Field, ModalForm } from "@/components/action-form";
import { CopyButton, ThemeToggle } from "@/components/follow-bits";
import { Composer } from "@/components/follow-composer";
import { ChatFields } from "@/components/follow-chat-fields";
import { atLeast, requireUser } from "@/lib/access";
import { db, fetchAll } from "@/lib/data";
import { acknowledge, addMember, bulkAddMembers, deleteChat, markRead, removeMember, reopen, saveChat, sendFollowUp, sendReply, setMemberEmail, syncWhatsAppNames } from "@/lib/follow";
import { CHANNELS, channelReady } from "@/lib/follow-send";
import { teamsAccount, teamsConfigured } from "@/lib/follow-providers";
import { DesktopAlerts } from "@/components/follow-live";

export const metadata = { title: "Follow-ups · Worldwide Service" };

type Channel = keyof typeof CHANNELS;
type Params = { show?: string; teams?: string; view?: string; channel?: string; chat?: string; tab?: string; q?: string; msg?: string; reply?: string; mention?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ICON: Record<Channel, string> = { whatsapp: "💬", sms: "📱", slack: "🔔", email: "✉️", teams: "🟣", google_chat: "🗨️" };
const DAY = 24 * 3600 * 1000;

const time = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
const ago = (iso: string | null) => {
  if (!iso) return "no activity";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${Math.max(m, 1)}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

export default async function FollowUps({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser("agent");
  const manager = atLeast(user.role, "manager");
  const sp = await searchParams;
  const theme = (await cookies()).get("fu_theme")?.value === "dark" ? "dark" : "light";
  const roleName = { admin: "Admin", manager: "Manager", agent: "Agent", dealership: "Store" }[user.role];
  const initials = user.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const view = sp.view === "manage" || sp.view === "analytics" ? sp.view : "dashboard";
  const client = db();
  // New replies are pulled in the background by <LiveSync />, so the page doesn't wait on the chat apps.
  // Everything the page needs is read at once.
  const [teams, chats, stores, { data: unreadRows }, { data: memberRows }] = await Promise.all([
    teamsConfigured() ? teamsAccount().catch(() => null) : Promise.resolve(null),
    fetchAll<any>("follow_chats", "id,name,channel,dealership_id,active,last_activity,whatsapp_group_id,teams_chat_id,google_chat_space,linq_group_id,slack_channel_id", "name"),
    fetchAll<any>("dealerships", "id,name,active", "name"),
    // "Pending" means store messages nobody has answered or acknowledged yet.
    client.from("follow_messages").select("chat_id").eq("direction", "inbound").is("handled_kind", null).limit(5000),
    client.from("follow_members").select("id,chat_id,name,phone,email,role").order("name").limit(10000),
  ]);
  const unread = new Map<string, number>();
  for (const r of (unreadRows ?? []) as any[]) unread.set(r.chat_id, (unread.get(r.chat_id) ?? 0) + 1);
  const members = new Map<string, any[]>();
  for (const m of (memberRows ?? []) as any[]) members.set(m.chat_id, [...(members.get(m.chat_id) ?? []), m]);
  const status = (c: any) => (unread.get(c.id) ? "pending" : c.last_activity && Date.now() - new Date(c.last_activity).getTime() < DAY ? "active" : "inactive");
  const channels = Object.keys(CHANNELS) as Channel[];
  const selected = sp.chat && UUID.test(sp.chat) ? chats.find((c: any) => c.id === sp.chat) : undefined;
  const channel: Channel = (channels.includes(sp.channel as Channel) ? sp.channel : selected?.channel ?? "whatsapp") as Channel;
  const activeStores = stores.filter((s: any) => s.active !== false).map((s: any) => ({ id: s.id as string, name: s.name as string }));
  const link = (p: Params) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ view: undefined, channel, ...p })) if (v) q.set(k, v);
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
          <Link href={link({ view: "analytics" })} className={view === "analytics" ? "active" : ""}><BarChart3 size={16} /> Analytics</Link>
        </nav>
        <p className="fu-side-label">Channels</p>
        <div className="fu-channels">
          {channels.map((ch) => (
            <Link key={ch} href={link({ channel: ch, view: view === "dashboard" ? undefined : view })} className={ch === channel ? "active" : ""} title={CHANNELS[ch]}>
              <span aria-hidden>{ICON[ch]}</span><span className="fu-ch-name">{CHANNELS[ch]}</span>
              <i className={(ch === "teams" ? !!teams : channelReady(ch)) ? "on" : ""} aria-label={(ch === "teams" ? !!teams : channelReady(ch)) ? "connected" : "not connected"} />
            </Link>
          ))}
        </div>
        {channel === "teams" ? (
          <div className={`fu-conn ${teams ? "on" : ""}`}>
            {!teamsConfigured() ? "Microsoft Teams: keys missing in Vercel" : teams ? <>Microsoft Teams: connected as {teams.name ?? teams.account}</> : "Microsoft Teams: not signed in"}
            {teamsConfigured() && manager && <a className="fu-conn-btn" href="/api/public/microsoft-auth-start">{teams ? "Reconnect Teams" : "Connect Teams"}</a>}
            {sp.teams && <span className="fu-conn-note">{{ connected: "Teams is connected.", failed: "Microsoft didn't accept the sign-in. Check the redirect URI and permissions.", expired: "The sign-in took too long. Try again.", cancelled: "Sign-in was cancelled.", denied: "Only managers can connect Teams.", missing: "Add the Microsoft keys in Vercel first." }[sp.teams] ?? ""}</span>}
          </div>
        ) : (
          <div className={`fu-conn ${channelReady(channel) ? "on" : ""}`}>
            {CHANNELS[channel]}: {channelReady(channel) ? "Connected" : "Not connected yet"}
          </div>
        )}
        {channel !== "teams" && teamsConfigured() && manager && !teams && (
          <div className="fu-conn">
            Microsoft Teams: not signed in
            <a className="fu-conn-btn" href="/api/public/microsoft-auth-start">Connect Teams</a>
          </div>
        )}
        <DesktopAlerts />
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
    </div>
  );

  function Dashboard() {
    const needle = (sp.q ?? "").trim().toLowerCase();
    const list = chats
      .filter((c: any) => c.channel === channel && (!needle || c.name.toLowerCase().includes(needle)))
      .sort((a: any, b: any) => (unread.get(b.id) ?? 0) - (unread.get(a.id) ?? 0) || String(b.last_activity ?? "").localeCompare(String(a.last_activity ?? "")));
    return (
      <>
        <section className="fu-list" aria-label="Dealerships">
          <div className="fu-list-head">
            <h1>Dealerships</h1>
            <p>{list.length} on {CHANNELS[channel]} · click one to open it</p>
            <form className="fu-search">
              <input type="hidden" name="channel" value={channel} />
              <Search size={15} aria-hidden />
              <input name="q" defaultValue={sp.q ?? ""} placeholder="Filter dealerships…" aria-label="Filter dealerships" />
            </form>
            <form className="fu-search">
              <input type="hidden" name="channel" value={channel} />
              <MessageSquareText size={15} aria-hidden />
              <input name="msg" defaultValue={sp.msg ?? ""} placeholder="Search all messages…" aria-label="Search all messages" />
            </form>
            {manager && (
              <ModalForm button="+ Add dealership chat" title="New chat" note="Add a store's follow-up chat. The id comes from the chat app." action={saveChat.bind(null, null)} submit="Add chat">
                <ChatFields chat={{ channel, active: true }} stores={activeStores} />
              </ModalForm>
            )}
          </div>
          {sp.msg?.trim() ? <MessageResults /> : <ul className="fu-items">
            {list.length === 0 && <li className="fu-muted fu-pad">No {CHANNELS[channel]} chats{needle ? " match" : " yet"}.</li>}
            {list.map((c: any) => {
              const st = status(c);
              return (
                <li key={c.id}>
                  <Link href={link({ chat: c.id, q: sp.q })} className={`fu-item${selected?.id === c.id ? " active" : ""}`}>
                    <span className="fu-item-top"><strong>{c.name}</strong>{unread.get(c.id) ? <b className="fu-count">{unread.get(c.id)}</b> : null}<em className={`fu-badge ${st}`}>{st === "pending" ? "Pending" : st === "active" ? "Active" : "Inactive"}</em></span>
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
    const term = (sp.msg ?? "").trim().slice(0, 100).replace(/[%_\\]/g, "\\$&");
    const { data } = await client.from("follow_messages").select("id,chat_id,body,direction,sender_name,created_at").ilike("body", `%${term}%`).order("created_at", { ascending: false }).limit(60);
    const rows = (data ?? []) as any[];
    const byId = new Map(chats.map((c: any) => [c.id, c]));
    return (
      <ul className="fu-items">
        <li className="fu-muted" style={{ fontSize: 12 }}>{rows.length} {rows.length === 1 ? "message" : "messages"} found · <Link href={link({})}>clear search</Link></li>
        {rows.map((m) => {
          const c: any = byId.get(m.chat_id);
          return (
            <li key={m.id}>
              <Link href={link({ chat: m.chat_id, channel: c?.channel, msg: sp.msg })} className="fu-item">
                <span className="fu-item-top"><strong>{c?.name ?? "Chat"}</strong><em className="fu-badge">{m.direction === "inbound" ? "Reply" : "Sent"}</em></span>
                <span className="fu-snippet">{m.body.slice(0, 140)}</span>
                <span className="fu-item-sub">{day(m.created_at)} {time(m.created_at)}</span>
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
    const ident = chat.whatsapp_group_id ?? chat.teams_chat_id ?? chat.google_chat_space ?? chat.linq_group_id ?? chat.slack_channel_id;
    return (
      <>
        <header className="fu-detail-head">
          <div>
            <h2>{chat.name} <em className="fu-pill">{ICON[ch]} {CHANNELS[ch]}</em> <em className={`fu-badge ${status(chat)}`}>{status(chat) === "pending" ? "Pending" : status(chat) === "active" ? "Active" : "Inactive"}</em>{!chat.active && <em className="fu-badge off">Off</em>}</h2>
            <p className="fu-mono fu-muted">{ident ? `id: ${ident}` : "No chat id yet"}{store ? <> · <Link href={`/service/info?d=${store.id}`}>{store.name}</Link></> : null}</p>
          </div>
          <div className="fu-head-actions">
            {ident && <CopyButton value={ident} />}
            {manager && (
              <ModalForm button="Settings" title="Chat settings" action={saveChat.bind(null, chat.id)}>
                <ChatFields chat={chat} stores={stores.filter((s: any) => s.active !== false || s.id === chat.dealership_id)} />
              </ModalForm>
            )}
            {manager && <ActionButton label="Delete" confirm={`Delete "${chat.name}", its roster and its messages? This can't be undone.`} action={deleteChat.bind(null, chat.id)} />}
          </div>
        </header>
        <div className="fu-tabs" role="tablist">
          <Link role="tab" aria-selected={tab === "chat"} href={link({ chat: chat.id, q: sp.q })}><MessagesSquare size={14} /> Chat &amp; Dispatch</Link>
          <Link role="tab" aria-selected={tab === "roster"} href={link({ chat: chat.id, tab: "roster", q: sp.q })}><Users size={14} /> Roster</Link>
        </div>
        {tab === "chat" ? <Thread chat={chat} people={people} /> : <Roster chat={chat} people={people} />}
      </>
    );
  }

  async function Thread({ chat, people }: { chat: any; people: any[] }) {
    const { data } = await client.from("follow_messages").select("id,direction,body,sender_name,sender,kind,status,error,read,created_at,reply_to,handled_kind,handled_name,handled_at").eq("chat_id", chat.id).order("created_at", { ascending: false }).limit(200);
    const all = ((data ?? []) as any[]).reverse();
    const byId = new Map(all.map((m) => [m.id, m]));
    // Our replies sit under the store message they answer, not in the main stream.
    const answers = new Map<string, any[]>();
    for (const m of all) if (m.direction === "outbound" && m.reply_to && byId.has(m.reply_to)) answers.set(m.reply_to, [...(answers.get(m.reply_to) ?? []), m]);
    const open = all.filter((m) => m.direction === "inbound" && !m.handled_kind);
    const onlyOpen = sp.show === "open";
    const stream = onlyOpen ? open : all.filter((m) => !(m.direction === "outbound" && m.reply_to && byId.has(m.reply_to)));
    const pending = all.filter((m) => m.direction === "inbound" && !m.read).length;
    const advisors = people.filter((p) => !/wwbdc|worldwide|service bdc|management/i.test(`${p.name} ${p.email ?? ""}`)).map((p) => p.name as string);
    const recipients = chat.channel === "email" ? people.filter((p) => p.email).length : people.length;
    const quoted = sp.reply ? byId.get(sp.reply) : undefined;
    const who = (m: any) => (m.direction === "outbound" ? "WWBDC" : m.sender_name || m.sender || "Store");
    const here = { chat: chat.id, q: sp.q, show: sp.show };
    let lastDay = "";
    return (
      <>
        <div className="fu-thread-tools">
          <Link href={link({ ...here, show: undefined })} className={!onlyOpen ? "active" : ""}>All messages</Link>
          <Link href={link({ ...here, show: "open" })} className={onlyOpen ? "active" : ""}>Needs reply{open.length ? <b>{open.length}</b> : null}</Link>
          <span className="fu-legend"><i className="in" /> Store <i className="reply" /> Our reply <i className="out" /> Our message <i className="dispatch" /> Dispatch</span>
          {pending > 0 && <form action={markRead.bind(null, chat.id)} className="fu-markread"><button>Mark {pending} as read</button></form>}
        </div>
        <div className="fu-thread-wrap"><div>
          {stream.length === 0 && <p className="fu-muted fu-pad">{onlyOpen ? "Nothing waiting. Every store message has been answered or acknowledged." : "No messages yet. Sent follow-ups and the store's replies show here."}</p>}
          <ol className="fu-thread">
            {stream.map((m) => {
              const d = day(m.created_at);
              const sep = !onlyOpen && d !== lastDay ? (lastDay = d) : null;
              const kind = m.direction === "inbound" ? "inbound" : m.kind === "follow_up" ? "outbound dispatch" : m.reply_to ? "outbound reply" : "outbound";
              const label = m.direction === "inbound" ? who(m) : m.kind === "follow_up" ? "Follow-up dispatch" : m.reply_to ? "Our reply" : "Our message";
              const replies = answers.get(m.id) ?? [];
              return (
                <li key={m.id} className="fu-row">
                  {sep && <div className="fu-day">{sep}</div>}
                  {onlyOpen && <div className="fu-day">{day(m.created_at)}</div>}
                  <div className={`fu-bubble ${kind}${m.direction === "inbound" && !m.handled_kind ? " open" : ""}${m.direction === "inbound" && !m.read ? " unread" : ""}${m.status === "failed" ? " failed" : ""}`}>
                    <span className="fu-who">{label}</span>
                    {m.direction === "inbound" && m.sender && m.sender_name && <span className="fu-mono fu-from">{m.sender}</span>}
                    {m.direction === "outbound" && m.reply_to && byId.get(m.reply_to) && <span className="fu-quote">↪ {who(byId.get(m.reply_to))}: {byId.get(m.reply_to).body.slice(0, 80)}</span>}
                    <p>{m.body}</p>
                    <span className="fu-time">{time(m.created_at)}{m.direction === "outbound" && m.sender_name ? ` · ${m.sender_name}` : ""}</span>
                    {m.status === "failed" && <span className="fu-notsent">Not sent{m.error ? `: ${m.error}` : ""}</span>}
                  </div>
                  {m.direction === "inbound" && (
                    <div className="fu-handled">
                      {m.handled_kind ? (
                        <span className={`fu-state ${m.handled_kind}`}>{m.handled_kind === "answered" ? "✓ Answered" : "👍 Acknowledged"} by {m.handled_name ?? "BDC"} · {time(m.handled_at)}</span>
                      ) : <span className="fu-state open">Needs reply</span>}
                      <Link href={link({ ...here, reply: m.id })}><Reply size={12} /> Reply</Link>
                      {!m.handled_kind && <form action={acknowledge.bind(null, chat.id, m.id)}><button>👍 Acknowledge</button></form>}
                      {m.handled_kind && <form action={reopen.bind(null, chat.id, m.id)}><button>Reopen</button></form>}
                    </div>
                  )}
                  {replies.length > 0 && (
                    <ul className="fu-answers">
                      {replies.map((r) => (
                        <li key={r.id} className={`fu-bubble outbound reply${r.status === "failed" ? " failed" : ""}`}>
                          <span className="fu-who">Our reply</span>
                          <p>{r.body}</p>
                          <span className="fu-time">{time(r.created_at)}{r.sender_name ? ` · ${r.sender_name}` : ""}</span>
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
          channel={CHANNELS[chat.channel as Channel]} recipients={recipients} advisors={advisors} sendMessage={sendReply.bind(null, chat.id)} sendDispatch={sendFollowUp.bind(null, chat.id)} />
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
                <strong>{c.name}</strong> <em className={`fu-badge ${status(c)}`}>{status(c) === "pending" ? "Pending" : status(c) === "active" ? "Active" : "Inactive"}</em>
                <span className="fu-muted"> · {people.length} members</span>
                <span className="fu-pill">{ICON[c.channel as Channel]} {CHANNELS[c.channel as Channel]}</span>
                <Link className="fu-open" href={link({ chat: c.id, channel: c.channel })}>Open</Link>
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

  function Analytics() {
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

