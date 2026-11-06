"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import type { Result } from "@/lib/manage";

type Action = (state: Result, form: FormData) => Promise<Result>;
const REASONS = ["Wants a service update", "Coming in to pick up vehicle", "Declined recommended services", "Asking about pricing", "Wants to reschedule", "Requesting a callback"];

// The bottom of a chat: a plain message, or a customer dispatch in the BDC's usual layout.
export function Composer({ channel, recipients, advisors, sendMessage, sendDispatch }: { channel: string; recipients: number; advisors: string[]; sendMessage: Action; sendDispatch: Action }) {
  const [mode, setMode] = useState<"message" | "dispatch">("message");
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
      {mode === "message" ? <MessageForm channel={channel} action={sendMessage} /> : <DispatchForm advisors={advisors} action={sendDispatch} />}
    </div>
  );
}

function Status({ state }: { state: Result }) {
  if (state.error) return <p role="alert" className="fu-error">{state.error}</p>;
  if (state.ok) return <p role="status" className="fu-ok">Sent.</p>;
  return null;
}

function MessageForm({ channel, action }: { channel: string; action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [body, setBody] = useState("");
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) setBody(""); }, [state]);
  return (
    <form ref={form} action={formAction}>
      <textarea className="fu-input" name="body" rows={3} maxLength={4096} placeholder={`Message via ${channel}…`} value={body} onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.current?.requestSubmit(); }} />
      <Status state={state} />
      <div className="fu-composer-foot">
        <span className="fu-muted">{body.length}/4096</span>
        <button className="fu-send" disabled={pending || !body.trim()}>{pending ? "Sending…" : "Send message"}</button>
      </div>
    </form>
  );
}

function DispatchForm({ advisors, action }: { advisors: string[]; action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const empty = { customer_name: "", customer_phone: "", vehicle: "", advisor: "", vin: "", reason: "" };
  const [f, setF] = useState(empty);
  useEffect(() => { if (state.ok) setF(empty); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const preview = [
    `Name and Last name: ${f.customer_name}`,
    `Phone number: ${f.customer_phone}`,
    f.vehicle && `Vehicle: ${f.vehicle}`,
    f.vin && `VIN: ${f.vin.toUpperCase()}`,
    f.advisor && `Advisor: ${f.advisor}`,
    `Reason for a call: ${f.reason}`,
  ].filter(Boolean).join("\n");
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
      <div className="fu-preview"><span className="fu-eyebrow">Preview</span><pre>{preview}</pre></div>
      <Status state={state} />
      <div className="fu-composer-foot">
        <button type="button" className="fu-ghost" onClick={() => setF(empty)}>Clear</button>
        <button className="fu-send" disabled={pending || !f.customer_name || !f.customer_phone || !f.reason}>{pending ? "Sending…" : "Send dispatch"}</button>
      </div>
    </form>
  );
}
