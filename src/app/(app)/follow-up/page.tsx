import Link from "next/link";
import { ModalForm } from "@/components/action-form";
import { ChatFields } from "@/components/follow-chat-fields";
import { Card, Page, Table } from "@/components/ui";
import { atLeast, requireUser } from "@/lib/access";
import { db, fetchAll } from "@/lib/data";
import { saveChat } from "@/lib/follow";
import { CHANNELS, channelReady } from "@/lib/follow-send";
import { showLocal } from "@/lib/scope";

export const metadata = { title: "Follow-ups · Worldwide Service" };

export default async function FollowUps({ searchParams }: { searchParams: Promise<{ q?: string; channel?: string; store?: string }> }) {
  const user = await requireUser("agent");
  const manager = atLeast(user.role, "manager");
  const { q = "", channel = "", store = "" } = await searchParams;
  const client = db();
  const [chats, stores, { data: unread }, { data: counts }] = await Promise.all([
    fetchAll<any>("follow_chats", "id,name,channel,dealership_id,active,last_activity", "name"),
    fetchAll<any>("dealerships", "id,name,active", "name"),
    client.from("follow_messages").select("chat_id").eq("direction", "inbound").eq("read", false).limit(5000),
    client.from("follow_members").select("chat_id").limit(10000),
  ]);
  const storeName = new Map(stores.map((s: any) => [s.id as string, s.name as string]));
  const unreadBy = new Map<string, number>();
  for (const m of (unread ?? []) as any[]) unreadBy.set(m.chat_id, (unreadBy.get(m.chat_id) ?? 0) + 1);
  const membersBy = new Map<string, number>();
  for (const m of (counts ?? []) as any[]) membersBy.set(m.chat_id, (membersBy.get(m.chat_id) ?? 0) + 1);
  const needle = q.trim().toLowerCase();
  const shown = chats
    .filter((c: any) => (!channel || c.channel === channel) && (!store || c.dealership_id === store) && (!needle || `${c.name} ${storeName.get(c.dealership_id) ?? ""}`.toLowerCase().includes(needle)))
    .sort((a: any, b: any) => (unreadBy.get(b.id) ?? 0) - (unreadBy.get(a.id) ?? 0) || String(b.last_activity ?? "").localeCompare(String(a.last_activity ?? "")));
  const activeStores = stores.filter((s: any) => s.active !== false).map((s: any) => ({ id: s.id as string, name: s.name as string }));
  const off = (Object.keys(CHANNELS) as (keyof typeof CHANNELS)[]).filter((k) => !channelReady(k));

  return (
    <Page
      title="Follow-ups"
      subtitle="Send customer follow-ups to each store's chat and see their replies."
      actions={manager ? <ModalForm button="+ New chat" title="New chat" note="Add a store's follow-up chat. The id comes from the chat app." action={saveChat.bind(null, null)} submit="Add chat"><ChatFields stores={activeStores} /></ModalForm> : undefined}
    >
      {off.length > 0 && (
        <Card><p className="text-sm">Not connected yet: {off.map((k) => CHANNELS[k]).join(", ")}. Messages to those chats are saved here as not sent until they&apos;re connected.</p></Card>
      )}
      <Card title="Chats" note={`${shown.length} of ${chats.length}`}>
        <form className="x-filters" style={{ marginBottom: 14 }}>
          <input className="x-input" name="q" defaultValue={q} placeholder="Search chats or stores" aria-label="Search" />
          <select className="x-input" name="channel" defaultValue={channel} aria-label="Channel"><option value="">All channels</option>{Object.entries(CHANNELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select className="x-input" name="store" defaultValue={store} aria-label="Store"><option value="">All stores</option>{activeStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <button className="x-btn x-btn-primary">Apply</button>
          {(q || channel || store) && <Link className="x-btn" href="/follow-up" style={{ display: "inline-flex", alignItems: "center" }}>Clear</Link>}
        </form>
        <Table
          head={["Chat", "Store", "Channel", "People", "Last activity", "New replies"]}
          empty="No chats match."
          rows={shown.map((c: any) => [
            <Link key="n" className="text-accent" href={`/follow-up/${c.id}`}>{c.name}{c.active ? "" : " (off)"}</Link>,
            storeName.get(c.dealership_id) ?? "—",
            CHANNELS[c.channel as keyof typeof CHANNELS] ?? c.channel,
            membersBy.get(c.id) ?? 0,
            c.last_activity ? showLocal(c.last_activity, "America/New_York") : "—",
            unreadBy.get(c.id) ? <strong key="u">{unreadBy.get(c.id)}</strong> : "",
          ])}
        />
      </Card>
    </Page>
  );
}
