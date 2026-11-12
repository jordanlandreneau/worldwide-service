"use client";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
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
type Person = { name: string; email: string | null; phone: string | null };

export function Composer({ chatId, channel, recipients, advisors, people = [], initialText = "", replyTo, sendMessage, sendDispatch }: {
  chatId: string; channel: string; recipients: number; advisors: string[]; people?: Person[]; initialText?: string; replyTo?: ReplyTo; sendMessage: Action; sendDispatch: Action;
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
        ? <MessageForm channel={channel} people={people} body={body} setBody={setBody} replyTo={replyTo} action={sendMessage} onSent={() => { setBody(""); clearDraft(); }} onDraft={saveDraft} saved={saved} />
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

function MessageForm({ channel, people, body, setBody, replyTo, action, onSent, onDraft, saved }: { channel: string; people: Person[]; body: string; setBody: (v: string) => void; replyTo?: ReplyTo; action: Action; onSent: () => void; onDraft: () => void; saved: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [tagged, setTagged] = useState<Person[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const [state, formAction, pending] = useSent(action, () => { onSent(); setFiles([]); setTagged([]); });
  const form = useRef<HTMLFormElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : "")), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);
  // Keep the picked files on the real file input so they're sent with the form.
  useEffect(() => { if (!fileInput.current) return; const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f)); fileInput.current.files = dt.files; }, [files]);
  const matches = query === null ? [] : people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
  // Big photos are shrunk in the browser (longest side 1600px) so a message stays under the upload limit.
  const shrink = async (f: File): Promise<File> => {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size < 900_000) return f;
    try {
      const img = await createImageBitmap(f);
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
      return blob ? new File([blob], f.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : f;
    } catch { return f; }
  };
  const addFiles = async (list: FileList | File[] | null) => {
    const ok = await Promise.all(Array.from(list ?? []).filter((f) => /^image\/|pdf$/.test(f.type)).map(shrink));
    setFiles((cur) => [...cur, ...ok].slice(0, 6));
  };
  // "@" opens the list of people in the chat; picking one writes @Name and remembers who it is.
  const onType = (v: string) => {
    setBody(v);
    const caret = box.current?.selectionStart ?? v.length;
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(v.slice(0, caret));
    setQuery(m && people.length ? m[2] : null);
    setPick(0);
  };
  const choose = (p: Person) => {
    const el = box.current;
    const caret = el?.selectionStart ?? body.length;
    const before = body.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.name} `);
    const next = before + body.slice(caret);
    setBody(next);
    setTagged((t) => (t.some((x) => x.name === p.name) ? t : [...t, p]));
    setQuery(null);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(before.length, before.length); });
  };
  const live = tagged.filter((p) => body.includes(`@${p.name}`));
  return (
    <form ref={form} action={formAction} onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } }}>
      {replyTo && (
        <div className="fu-replying">
          <input type="hidden" name="reply_to" value={replyTo.id} />
          <span><strong>Replying to {replyTo.who}</strong><em>{replyTo.text}</em></span>
          <a href={replyTo.cancelHref} aria-label="Cancel reply">✕</a>
        </div>
      )}
      <input type="hidden" name="mentions" value={JSON.stringify(live)} />
      <input ref={fileInput} type="file" name="pictures" multiple hidden accept="image/*,application/pdf" onChange={(e) => { addFiles(e.target.files); }} />
      <div className="fu-typing">
        <textarea ref={box} className="fu-input" name="body" rows={3} maxLength={4096} placeholder={`Message via ${channel}… (type @ to tag someone, paste or drop a picture)`} value={body}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (matches.length) {
              if (e.key === "ArrowDown") { e.preventDefault(); setPick((p) => (p + 1) % matches.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setPick((p) => (p - 1 + matches.length) % matches.length); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(matches[pick]); return; }
              if (e.key === "Escape") { setQuery(null); return; }
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.current?.requestSubmit();
          }} />
        {matches.length > 0 && (
          <ul className="fu-mention" role="listbox" aria-label="People in this chat">
            {matches.map((p, i) => (
              <li key={`${p.name}-${i}`} role="option" aria-selected={i === pick} onMouseDown={(e) => { e.preventDefault(); choose(p); }}>
                <strong>{p.name}</strong><small>{p.email ?? p.phone ?? ""}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
      {files.length > 0 && (
        <div className="fu-attach">
          {files.map((f, i) => (
            <span key={i} className="fu-attach-item">
              {previews[i] ? <img src={previews[i]} alt="" /> : <em>📄</em>}
              <small>{f.name}</small>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>✕</button>
            </span>
          ))}
        </div>
      )}
      {files.reduce((n, f) => n + f.size, 0) > 4_000_000 && <p className="fu-warn">These files are too big to send together (4 MB max). Remove one or send them in two messages.</p>}
      <Status state={state} saved={saved} />
      <div className="fu-composer-foot">
        <button type="button" className="fu-ghost" onClick={() => fileInput.current?.click()} title="Add pictures">📎 Picture</button>
        <span className="fu-muted">{body.length}/4096 · Ctrl+Enter to send</span>
        <button type="button" className="fu-ghost" onClick={onDraft} disabled={!body.trim()}>Save as draft</button>
        <button className="fu-send" disabled={pending || (!body.trim() && !files.length) || files.reduce((n, f) => n + f.size, 0) > 4_000_000}>{pending ? "Sending…" : "Send message"}</button>
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
