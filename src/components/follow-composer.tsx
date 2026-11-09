"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import type { Result } from "@/lib/manage";

type Action = (state: Result, form: FormData) => Promise<Result>;
type Dispatch = { customer_name: string; customer_phone: string; vehicle: string; advisor: string; vin: string; reason: string };
const REASONS = ["Wants a service update", "Coming in to pick up vehicle", "Declined recommended services", "Asking about pricing", "Wants to reschedule", "Requesting a callback"];
const EMPTY: Dispatch = { customer_name: "", customer_phone: "", vehicle: "", advisor: "", vin: "", reason: "" };

const read = (key: string) => { try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; } };
const write = (key: string, v: unknown) => { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage off */ } };

export function dispatchText(f: Dispatch) {
  return [
    `Name and Last name: ${f.customer_name}`,
    `Phone number: ${f.customer_phone}`,
    f.vehicle && `Vehicle: ${f.vehicle}`,
    f.vin && `VIN: ${f.vin.toUpperCase()}`,
    f.advisor && `@${f.advisor}`,
    `Reason for a call: ${f.reason}`,
  ].filter(Boolean).join("\n");
}

// The bottom of a chat: a plain message, or a customer dispatch in the BDC's usual layout.
// Drafts are kept in this browser per chat until sent or cleared.
type ReplyTo = { id: string; who: string; text: string; cancelHref: string };

export function Composer({ chatId, channel, recipients, advisors, initialText = "", replyTo, sendMessage, sendDispatch }: {
  chatId: string; channel: string; recipients: number; advisors: string[]; initialText?: string; replyTo?: ReplyTo; sendMessage: Action; sendDispatch: Action;
}) {
  const key = `fu_draft_${chatId}`;
  const [mode, setMode] = useState<"message" | "dispatch">("message");
  const [body, setBody] = useState(initialText);
  const [f, setF] = useState<Dispatch>(EMPTY);
  const [saved, setSaved] = useState("");
  useEffect(() => {
    const d = read(key);
    if (d) { if (!initialText) setBody(d.body ?? ""); setF({ ...EMPTY, ...(d.dispatch ?? {}) }); if (d.mode && !initialText) setMode(d.mode); }
  }, [key, initialText]);
  const saveDraft = () => { write(key, { body, dispatch: f, mode }); setSaved("Draft saved."); setTimeout(() => setSaved(""), 2000); };
  const clearDraft = () => write(key, null);

  return (
    <div className="fu-composer">
      <div className="fu-composer-head">
        <span className="fu-eyebrow">Dispatch via {channel}</span>
        <span className="fu-muted">{recipients} {recipients === 1 ? "recipient" : "recipients"}</span>
      </div>
      <div className="fu-seg" role="tablist" aria-label="What to send">
        <button type="button" role="tab" aria-selected={mode === "message"} onClick={() => setMode("message")}>Message</button>
        <button type="button" role="tab" aria-selected={mode === "dispatch"} onClick={() => setMode("dispatch")}>Customer dispatch</button>
      </div>
      {mode === "message"
        ? <MessageForm channel={channel} body={body} setBody={setBody} replyTo={replyTo} action={sendMessage} onSent={() => { setBody(""); clearDraft(); }} onDraft={saveDraft} saved={saved} />
        : <DispatchForm advisors={advisors} f={f} setF={setF} action={sendDispatch} onSent={() => { setF(EMPTY); clearDraft(); }} onDraft={saveDraft} saved={saved}
            onInsert={() => { setBody((b) => (b.trim() ? `${b.trim()}\n\n` : "") + dispatchText(f)); setMode("message"); }} />}
    </div>
  );
}

function Status({ state, saved }: { state: Result; saved: string }) {
  if (state.error) return <p role="alert" className="fu-error">{state.error}</p>;
  if (saved) return <p role="status" className="fu-ok">{saved}</p>;
  if (state.ok) return <p role="status" className="fu-ok">Sent.</p>;
  return null;
}

function useSent(action: Action, onSent: () => void) {
  const [state, formAction, pending] = useActionState(action, {});
  const last = useRef<Result>({});
  useEffect(() => { if (state.ok && state !== last.current) { last.current = state; onSent(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return [state, formAction, pending] as const;
}

function MessageForm({ channel, body, setBody, replyTo, action, onSent, onDraft, saved }: { channel: string; body: string; setBody: (v: string) => void; replyTo?: ReplyTo; action: Action; onSent: () => void; onDraft: () => void; saved: string }) {
  const [state, formAction, pending] = useSent(action, onSent);
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={formAction}>
      {replyTo && (
        <div className="fu-replying">
          <input type="hidden" name="reply_to" value={replyTo.id} />
          <span><strong>Replying to {replyTo.who}</strong><em>{replyTo.text}</em></span>
          <a href={replyTo.cancelHref} aria-label="Cancel reply">✕</a>
        </div>
      )}
      <textarea className="fu-input" name="body" rows={3} maxLength={4096} placeholder={`Message via ${channel}…`} value={body} onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.current?.requestSubmit(); }} />
      <Status state={state} saved={saved} />
      <div className="fu-composer-foot">
        <span className="fu-muted">{body.length}/4096 · Ctrl+Enter to send</span>
        <button type="button" className="fu-ghost" onClick={onDraft} disabled={!body.trim()}>Save as draft</button>
        <button className="fu-send" disabled={pending || !body.trim()}>{pending ? "Sending…" : "Send message"}</button>
      </div>
    </form>
  );
}

function DispatchForm({ advisors, f, setF, action, onSent, onDraft, onInsert, saved }: {
  advisors: string[]; f: Dispatch; setF: (v: Dispatch) => void; action: Action; onSent: () => void; onDraft: () => void; onInsert: () => void; saved: string;
}) {
  const [state, formAction, pending] = useSent(action, onSent);
  const set = (k: keyof Dispatch) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ready = !!(f.customer_name && f.customer_phone && f.reason);
  return (
    <form action={formAction}>
      <div className="fu-grid">
        <label><span>Name and last name</span><input className="fu-input" name="customer_name" value={f.customer_name} onChange={set("customer_name")} autoComplete="off" /></label>
        <label><span>Phone number</span><input className="fu-input" name="customer_phone" type="tel" value={f.customer_phone} onChange={set("customer_phone")} placeholder="(555) 555-5555" autoComplete="off" /></label>
        <label><span>Year, make and model</span><input className="fu-input" name="vehicle" value={f.vehicle} onChange={set("vehicle")} placeholder="2023 Kia K5" autoComplete="off" /></label>
        <label><span>Advisor</span><input className="fu-input" name="advisor" list="fu-advisors" value={f.advisor} onChange={set("advisor")} placeholder="Search the roster…" autoComplete="off" />
          <datalist id="fu-advisors">{advisors.map((a) => <option key={a} value={a} />)}</datalist></label>
      </div>
      <label className="fu-label"><span>VIN <em className="fu-muted">{f.vin.length}/17</em></span>
        <input className="fu-input fu-mono" name="vin" maxLength={17} value={f.vin} onChange={set("vin")} style={{ textTransform: "uppercase" }} autoComplete="off" /></label>
      <span className="fu-label-text">Reason for a call</span>
      <div className="fu-chips">{REASONS.map((r) => <button key={r} type="button" className="fu-chip" aria-pressed={f.reason === r} onClick={() => setF({ ...f, reason: r })}>{r}</button>)}</div>
      <textarea className="fu-input" name="reason" rows={2} value={f.reason} onChange={set("reason")} placeholder="Customer wants to know…" />
      {!f.advisor && <p className="fu-warn">No advisor selected. You can still send.</p>}
      <div className="fu-preview"><span className="fu-eyebrow">Preview</span><pre>{dispatchText(f)}</pre></div>
      <Status state={state} saved={saved} />
      <div className="fu-composer-foot">
        <button type="button" className="fu-ghost" onClick={onInsert} disabled={!ready}>Insert into message</button>
        <button type="button" className="fu-ghost" onClick={() => setF(EMPTY)}>Clear</button>
        <button type="button" className="fu-ghost" onClick={onDraft}>Save as draft</button>
        {!ready && <span className="fu-muted">Add a name, phone and reason to send.</span>}
        <button className="fu-send" disabled={pending || !ready}>{pending ? "Sending…" : "Send dispatch"}</button>
      </div>
    </form>
  );
}
