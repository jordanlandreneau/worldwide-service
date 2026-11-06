import Link from "next/link";
import { BarChart3, Building2, LayoutDashboard, MessagesSquare, Search, Users } from "lucide-react";
import { ActionButton, Field, ModalForm } from "@/components/action-form";
import { Composer } from "@/components/follow-composer";
import { ChatFields } from "@/components/follow-chat-fields";
import { atLeast, requireUser } from "@/lib/access";
import { db, fetchAll } from "@/lib/data";
import { addMember, markRead, removeMember, saveChat, sendFollowUp, sendReply } from "@/lib/follow";
import { CHANNELS, channelReady } from "@/lib/follow-send";

export const metadata = { title: "Follow-ups · Worldwide Service" };

type Channel = keyof typeof CHANNELS;
type Params = { view?: string; channel?: string; chat?: string; tab?: string; q?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ICON: Record<Channel, string> = { whatsapp: "💬", sms: "📱", email: "✉️", teams: "🟣", google_chat: "🗨️" };
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
  const view = sp.view === "manage" || sp.view === "analytics" ? sp.view : "dashboard";
  const client = db();
  const [chats, stores, { data: unreadRows }, { data: memberRows }] = await Promise.all([
    fetchAll<any>("follow_chats", "id,name,channel,dealership_id,active,last_activity,whatsapp_group_id,teams_chat_id,google_chat_space,linq_group_id", "name"),
    fetchAll<any>("dealerships", "id,name,active", "name"),
    client.from("follow_messages").select("chat_id").eq("direction", "inbound").eq("read", false).limit(5000),
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
    <div className="fu-app">
      <aside className="fu-side">
        <div className="fu-side-head">
          <span className="fu-logo"><MessagesSquare size={18} /></span>
          <div><strong>Service BDC Portal</strong><span>Follow-ups</span></div>
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
              <i className={channelReady(ch) ? "on" : ""} aria-label={channelReady(ch) ? "connected" : "not connected"} />
            </Link>
          ))}
        </div>
        <div className={`fu-conn ${channelReady(channel) ? "on" : ""}`}>
          {CHANNELS[channel]}: {channelReady(channel) ? "Connected" : "Not connected yet"}
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
            {manager && (
              <ModalForm button="+ Add dealership chat" title="New chat" note="Add a store's follow-up chat. The id comes from the chat app." action={saveChat.bind(null, null)} submit="Add chat">
                <ChatFields chat={{ channel, active: true }} stores={activeStores} />
              </ModalForm>
            )}
          </div>
          <ul className="fu-items">
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
          </ul>
        </section>
        <section className="fu-detail" aria-label="Chat">{selected ? <ChatPanel chat={selected} /> : <EmptyDetail />}</section>
      </>
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
    const ident = chat.whatsapp_group_id ?? chat.teams_chat_id ?? chat.google_chat_space ?? chat.linq_group_id;
    return (
      <>
        <header className="fu-detail-head">
          <div>
            <h2>{chat.name} <em className="fu-pill">{ICON[ch]} {CHANNELS[ch]}</em> <em className={`fu-badge ${status(chat)}`}>{status(chat) === "pending" ? "Pending" : status(chat) === "active" ? "Active" : "Inactive"}</em>{!chat.active && <em className="fu-badge off">Off</em>}</h2>
            <p className="fu-mono fu-muted">{ident ? `id: ${ident}` : "No chat id yet"}{store ? <> · <Link href={`/service/info?d=${store.id}`}>{store.name}</Link></> : null}</p>
          </div>
          {manager && (
            <ModalForm button="Settings" title="Chat settings" action={saveChat.bind(null, chat.id)}>
              <ChatFields chat={chat} stores={stores.filter((s: any) => s.active !== false || s.id === chat.dealership_id)} />
            </ModalForm>
          )}
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
    const { data } = await client.from("follow_messages").select("id,direction,body,sender_name,sender,status,error,read,created_at").eq("chat_id", chat.id).order("created_at", { ascending: false }).limit(200);
    const thread = ((data ?? []) as any[]).reverse();
    const pending = thread.filter((m) => m.direction === "inbound" && !m.read).length;
    const advisors = people.filter((p) => !/wwbdc|worldwide|service bdc|management/i.test(`${p.name} ${p.email ?? ""}`)).map((p) => p.name as string);
    const recipients = chat.channel === "email" ? people.filter((p) => p.email).length : people.length;
    let lastDay = "";
    return (
      <>
        <div className="fu-thread-wrap"><div>
          {pending > 0 && <form action={markRead.bind(null, chat.id)} className="fu-markread"><button>Mark {pending} {pending === 1 ? "reply" : "replies"} as read</button></form>}
          {thread.length === 0 && <p className="fu-muted fu-pad">No messages yet. Sent follow-ups and the store&apos;s replies show here.</p>}
          <ol className="fu-thread">
            {thread.map((m) => {
              const d = day(m.created_at);
              const sep = d !== lastDay ? (lastDay = d) : null;
              return (
                <li key={m.id} className="fu-row">
                  {sep && <div className="fu-day">{sep}</div>}
                  <div className={`fu-bubble ${m.direction}${m.direction === "inbound" && !m.read ? " unread" : ""}${m.status === "failed" ? " failed" : ""}`}>
                    <span className="fu-who">{m.direction === "outbound" ? "WWBDC" : m.sender_name || "Store"}</span>
                    {m.direction === "inbound" && m.sender && <span className="fu-mono fu-from">{m.sender}</span>}
                    <p>{m.body}</p>
                    <span className="fu-time">{time(m.created_at)}{m.direction === "outbound" && m.sender_name ? ` · ${m.sender_name}` : ""}</span>
                    {m.status === "failed" && <span className="fu-notsent">Not sent{m.error ? `: ${m.error}` : ""}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        </div></div>
        <Composer channel={CHANNELS[chat.channel as Channel]} recipients={recipients} advisors={advisors} sendMessage={sendReply.bind(null, chat.id)} sendDispatch={sendFollowUp.bind(null, chat.id)} />
      </>
    );
  }

  function Roster({ chat, people }: { chat: any; people: any[] }) {
    return (
      <div className="fu-roster">
        <p className="fu-eyebrow">Roster</p>
        {manager && (
          <div style={{ marginBottom: 14 }}>
            <ModalForm button="+ Add member" title="Add a member" note="Email chats send to everyone with an email here." action={addMember.bind(null, chat.id)} submit="Add">
              <Field label="Name"><input className="x-input" name="name" required /></Field>
              <Field label="Phone"><input className="x-input" name="phone" type="tel" /></Field>
              <Field label="Email"><input className="x-input" name="email" type="email" /></Field>
            </ModalForm>
          </div>
        )}
        {people.length === 0 && <p className="fu-muted">No members yet.</p>}
        <ul className="fu-people">
          {people.map((p) => (
            <li key={p.id}>
              <div><strong>{p.name}</strong><span className="fu-mono fu-muted">{p.phone ?? ""}</span></div>
              <span className={p.email ? "" : "fu-muted"}>{p.email ?? "No email"}</span>
              {manager ? <ActionButton label="Remove" confirm={`Remove ${p.name} from this roster?`} action={removeMember.bind(null, chat.id, p.id)} /> : <span />}
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

