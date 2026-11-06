import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, Field, InlineForm, ModalForm } from "@/components/action-form";
import { ChatFields } from "@/components/follow-chat-fields";
import { Card, Page, Table } from "@/components/ui";
import { atLeast, requireUser } from "@/lib/access";
import { db, fetchAll } from "@/lib/data";
import { addMember, markRead, removeMember, saveChat, sendFollowUp, sendReply } from "@/lib/follow";
import { CHANNELS, channelReady } from "@/lib/follow-send";
import { showLocal } from "@/lib/scope";

export const metadata = { title: "Follow-up chat · Worldwide Service" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FollowUpChat({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("agent");
  const manager = atLeast(user.role, "manager");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const client = db();
  const [{ data: chat }, { data: members }, { data: messages }, stores] = await Promise.all([
    client.from("follow_chats").select("*").eq("id", id).maybeSingle(),
    client.from("follow_members").select("id,name,phone,email,role").eq("chat_id", id).order("name"),
    client.from("follow_messages").select("id,direction,body,sender_name,sender,kind,status,error,read,created_at").eq("chat_id", id).order("created_at", { ascending: false }).limit(200),
    fetchAll<any>("dealerships", "id,name,active", "name"),
  ]);
  if (!chat) notFound();
  const store = stores.find((s: any) => s.id === chat.dealership_id);
  const people = (members ?? []) as any[];
  const thread = ((messages ?? []) as any[]).reverse();
  const unread = thread.filter((m) => m.direction === "inbound" && !m.read).length;
  const ready = channelReady(chat.channel);
  const channel = CHANNELS[chat.channel as keyof typeof CHANNELS] ?? chat.channel;
  const advisors = people.filter((p) => !/wwbdc|worldwide|service bdc/i.test(`${p.name} ${p.email ?? ""}`));

  return (
    <Page
      title={chat.name}
      subtitle={<>{channel}{store ? <> · <Link className="text-accent" href={`/service/info?d=${store.id}`}>{store.name}</Link></> : ""}{chat.active ? "" : " · turned off"}</>}
      actions={<Link className="x-btn" href="/follow-up" style={{ display: "inline-flex", alignItems: "center" }}>All chats</Link>}
    >
      {!ready && <Card><p className="text-sm">{channel} isn&apos;t connected to the Service site yet, so messages to this chat are saved here as not sent.</p></Card>}

      <Card title="Send a follow-up" note="Goes to the whole chat in the BDC's usual follow-up layout.">
        <InlineForm action={sendFollowUp.bind(null, id)} submit="Send follow-up">
          <div className="cc-form-grid">
            <Field label="Customer name"><input className="x-input" name="customer_name" required autoComplete="off" /></Field>
            <Field label="Phone number"><input className="x-input" name="customer_phone" type="tel" required autoComplete="off" placeholder="(555) 555-5555" /></Field>
            <Field label="Advisor (optional)">
              <input className="x-input" name="advisor" list="advisors" autoComplete="off" />
              <datalist id="advisors">{advisors.map((p) => <option key={p.id} value={p.name} />)}</datalist>
            </Field>
          </div>
          <div className="cc-form-grid">
            <Field label="Vehicle (optional)"><input className="x-input" name="vehicle" placeholder="2021 Toyota Camry" autoComplete="off" /></Field>
            <Field label="VIN (optional)"><input className="x-input" name="vin" maxLength={17} autoComplete="off" style={{ textTransform: "uppercase" }} /></Field>
          </div>
          <Field label="Reason for call"><textarea className="x-input" name="reason" rows={3} required placeholder="Customer would like a callback about…" /></Field>
        </InlineForm>
      </Card>

      <Card title="Messages" note={unread ? `${unread} new ${unread === 1 ? "reply" : "replies"}` : `${thread.length} shown`}>
        {unread > 0 && <form action={markRead.bind(null, id)} style={{ marginBottom: 12 }}><button className="x-btn">Mark replies as read</button></form>}
        {thread.length === 0 ? <p className="text-sm text-ink-muted">No messages yet. Sent follow-ups and the store&apos;s replies show here.</p> : (
          <ol className="fu-thread">
            {thread.map((m) => (
              <li key={m.id} className={`fu-msg ${m.direction}${m.direction === "inbound" && !m.read ? " unread" : ""}`}>
                <div className="fu-meta">
                  <strong>{m.sender_name || m.sender || (m.direction === "inbound" ? "Store" : "BDC")}</strong>
                  <span>{showLocal(m.created_at, "America/New_York")}</span>
                  {m.status === "failed" && <span className="fu-failed" title={m.error ?? undefined}>Not sent{m.error ? `: ${m.error}` : ""}</span>}
                </div>
                <p className="x-prewrap">{m.body}</p>
              </li>
            ))}
          </ol>
        )}
        <div style={{ marginTop: 14 }}>
          <InlineForm action={sendReply.bind(null, id)} submit="Send message">
            <Field label="Message the chat"><textarea className="x-input" name="body" rows={2} required /></Field>
          </InlineForm>
        </div>
      </Card>

      <Card title="People in this chat" note={`${people.length}`}>
        <Table
          head={["Name", "Phone or account", "Email", ...(manager ? [""] : [])]}
          empty="No one listed."
          rows={people.map((p) => [p.name, p.phone ?? "—", p.email ?? "—", ...(manager ? [<ActionButton key="r" label="Remove" confirm={`Remove ${p.name} from this chat's list?`} action={removeMember.bind(null, id, p.id)} />] : [])])}
        />
        {manager && (
          <div className="x-filters" style={{ marginTop: 12 }}>
            <ModalForm button="+ Add person" title="Add a person" note="Email chats send to everyone with an email here." action={addMember.bind(null, id)} submit="Add">
              <Field label="Name"><input className="x-input" name="name" required /></Field>
              <Field label="Email"><input className="x-input" name="email" type="email" /></Field>
              <Field label="Phone"><input className="x-input" name="phone" type="tel" /></Field>
            </ModalForm>
            <ModalForm button="Chat settings" title="Chat settings" action={saveChat.bind(null, id)}>
              <ChatFields chat={chat} stores={stores.filter((s: any) => s.active !== false || s.id === chat.dealership_id)} />
            </ModalForm>
          </div>
        )}
      </Card>
    </Page>
  );
}
