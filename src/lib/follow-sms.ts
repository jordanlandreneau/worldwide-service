import "server-only";
import { db } from "@/lib/data";
import { e164, justcall, lineKey } from "@/lib/justcall";

// Text follow-ups go through JustCall, from the dealership's JustCall number, to each phone in the chat's Roster.
// Replies come back the same way: incoming texts on that line from a Roster phone land in the chat.

type SmsChat = { id: string; dealership_id?: string | null; justcall_line?: string | null };

// The line a chat texts from: the store profile's "JustCall number (Service line)", unless the chat names its own.
export async function smsLine(chat: SmsChat): Promise<string | null> {
  if (lineKey(chat.justcall_line).length === 10) return lineKey(chat.justcall_line);
  if (!chat.dealership_id) return null;
  const client = db();
  const { data: dept } = await client.from("departments").select("id").ilike("name", "service").maybeSingle();
  if (!dept?.id) return null;
  const { data: link } = await client.from("dealership_departments").select("just_call_number").eq("dealership_id", chat.dealership_id).eq("department_id", dept.id).maybeSingle();
  return lineKey(link?.just_call_number).length === 10 ? lineKey(link!.just_call_number) : null;
}

async function sendOne(line: string, to: string, body: string) {
  // JustCall wants E.164 here; some accounts take the number without the plus, so that's the fallback.
  const attempt = (from: string, dest: string) => justcall("/texts/new", { method: "POST", body: JSON.stringify({ justcall_number: from, contact_number: dest, body }) });
  let res = await attempt(e164(line), e164(to));
  if (res.status === 400 || res.status === 422) res = await attempt(e164(line).replace(/^\+/, ""), e164(to).replace(/^\+/, ""));
  const json = (await res.json().catch(() => ({}))) as any;
  return res.ok ? { ok: true as const, id: String(json?.data?.id ?? json?.id ?? "") } : { ok: false as const, why: `${res.status}${json?.message ? ` ${json.message}` : ""}` };
}

export async function smsSend(chat: SmsChat, phones: string[], text: string) {
  if (!process.env.JUSTCALL_API_KEY || !process.env.JUSTCALL_API_SECRET) return { ok: false as const, error: "JustCall isn't connected: JUSTCALL_API_KEY is missing." };
  const line = await smsLine(chat);
  if (!line) return { ok: false as const, error: "This chat's store has no Service line. Add the JustCall number (Service line) on the store profile, then send again." };
  const to = [...new Set(phones.map((p) => lineKey(p)).filter((p) => p.length === 10 && p !== line))];
  if (!to.length) return { ok: false as const, error: "Add the store people's mobile numbers in the Roster, then send again." };
  if (text.length > 1600) return { ok: false as const, error: "Texts can be at most 1,600 characters." };
  const results = await Promise.all(to.map((p) => sendOne(line, p, text).then((r) => ({ p, ...r })).catch(() => ({ p, ok: false as const, why: "no answer" }))));
  const sent = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok) as { p: string; why: string }[];
  if (!sent.length) return { ok: false as const, error: `JustCall didn't send it (${failed[0]?.why ?? "unknown"}).` };
  return { ok: true as const, externalId: (sent[0] as any).id || undefined, partial: failed.length ? `Not delivered to ${failed.map((f) => `(${f.p.slice(0, 3)}) ${f.p.slice(3, 6)}-${f.p.slice(6)}`).join(", ")}` : undefined };
}

// Incoming texts on each text chat's line, from a phone in that chat's Roster.
export async function smsPull(saveNew: (chatId: string, list: { body: string; sender: string | null; senderName: string | null; externalId: string; at: string }[]) => Promise<number>, sinceMs: number) {
  if (!process.env.JUSTCALL_API_KEY || !process.env.JUSTCALL_API_SECRET) return 0;
  const client = db();
  const { data: chats } = await client.from("follow_chats").select("id,dealership_id,justcall_line").eq("channel", "sms").eq("active", true);
  const list = (chats ?? []) as SmsChat[];
  if (!list.length) return 0;
  const { data: members } = await client.from("follow_members").select("chat_id,phone,name").in("chat_id", list.map((c) => c.id));
  // line → (phone → {chat, name})
  const routes = new Map<string, Map<string, { chat: string; name: string | null }>>();
  for (const c of list) {
    const line = await smsLine(c);
    if (!line) continue;
    const m = routes.get(line) ?? new Map();
    for (const p of ((members ?? []) as any[]).filter((x) => x.chat_id === c.id)) { const k = lineKey(p.phone); if (k.length === 10) m.set(k, { chat: c.id, name: p.name ?? null }); }
    routes.set(line, m);
  }
  const from = new Date(sinceMs).toISOString().slice(0, 19).replace("T", " ");
  const to = new Date(Date.now() - 30_000).toISOString().slice(0, 19).replace("T", " ");
  let added = 0;
  for (const [line, phones] of routes) {
    if (!phones.size) continue;
    try {
      const q = new URLSearchParams({ justcall_number: e164(line).replace(/^\+/, ""), sms_direction: "incoming", from_datetime: from, to_datetime: to, per_page: "100", sort: "id", order: "desc" });
      const res = await justcall(`/texts?${q}`, undefined, 0);
      if (!res.ok) continue;
      const texts = (((await res.json()) as any)?.data ?? []) as any[];
      const byChat = new Map<string, any[]>();
      for (const t of texts.reverse()) {
        const who = phones.get(lineKey(t.contact_number));
        const body = String(t.sms_info?.body ?? t.body ?? "").trim();
        if (!who || !body) continue;
        byChat.set(who.chat, [...(byChat.get(who.chat) ?? []), { body, sender: lineKey(t.contact_number), senderName: who.name || t.contact_name || null, externalId: `jc-${t.id}`, at: `${t.sms_date ?? ""}T${t.sms_time ?? "00:00:00"}Z` }]);
      }
      for (const [chat, items] of byChat) added += await saveNew(chat, items);
    } catch { /* try again next pull */ }
  }
  return added;
}
