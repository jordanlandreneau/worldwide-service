import { Field } from "@/components/action-form";
import { CHANNEL_NAMES as CHANNELS } from "@/lib/follow-channels";

export function ChatFields({ chat, stores }: { chat?: any; stores: { id: string; name: string }[] }) {
  return (
    <>
      <Field label="Chat name"><input className="x-input" name="name" required defaultValue={chat?.name ?? ""} placeholder="Store // WWBDC Follow Up" /></Field>
      <Field label="Channel">
        <select className="x-input" name="channel" defaultValue={chat?.channel ?? "whatsapp"}>{Object.entries(CHANNELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </Field>
      <Field label="Service store (optional)">
        <select className="x-input" name="dealership_id" defaultValue={chat?.dealership_id ?? ""}><option value="">Not linked</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </Field>
      <Field label="WhatsApp group id (WhatsApp chats)"><input className="x-input" name="whatsapp_group_id" defaultValue={chat?.whatsapp_group_id ?? ""} placeholder="120363...@g.us" /></Field>
      <Field label="Teams chat id (Teams chats)"><input className="x-input" name="teams_chat_id" defaultValue={chat?.teams_chat_id ?? ""} placeholder="19:...@thread.v2" /></Field>
      <Field label="Google Chat space (Google Chat)"><input className="x-input" name="google_chat_space" defaultValue={chat?.google_chat_space ?? ""} placeholder="spaces/AAAA..." /></Field>
      <Field label="Linq group id (text chats)"><input className="x-input" name="linq_group_id" defaultValue={chat?.linq_group_id ?? ""} /></Field>
      {chat && <label className="text-sm" style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="active" defaultChecked={chat.active} /> Chat is on</label>}
    </>
  );
}
