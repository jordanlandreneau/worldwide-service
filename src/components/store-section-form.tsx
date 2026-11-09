"use client";
import { type ReactNode, useActionState, useEffect, useRef, useState } from "react";
import { type Block, normalizeSection, STYLES, TONES, type Style, type Tone } from "@/lib/blocks";
import type { Result } from "@/lib/manage";

const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- Rich text with a formatting toolbar ----------
const HIGHLIGHTS = [["#fff3a3", "Yellow"], ["#c9f2d4", "Green"], ["#cfe2ff", "Blue"], ["#ffd6e0", "Pink"]];
const COLORS = [["#b42318", "Red"], ["#1f5fbf", "Blue"], ["#15803d", "Green"], ["#10161f", "Black"]];

function RichText({ value, onChange, compact }: { value: string; onChange: (html: string) => void; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(cmd, false, arg);
    onChange(ref.current?.innerHTML ?? "");
  };
  const btn = (label: ReactNode, title: string, act: () => void) => (
    <button type="button" title={title} aria-label={title} onMouseDown={(e) => { e.preventDefault(); act(); }}>{label}</button>
  );
  return (
    <div className={`rt${compact ? " compact" : ""}`}>
      <div className="rt-bar" role="toolbar" aria-label="Formatting">
        {btn(<b>B</b>, "Bold", () => run("bold"))}
        {btn(<i>I</i>, "Italic", () => run("italic"))}
        {btn(<u>U</u>, "Underline", () => run("underline"))}
        {btn(<s>S</s>, "Strikethrough", () => run("strikeThrough"))}
        <span className="rt-sep" />
        {HIGHLIGHTS.map(([c, n]) => btn(<span className="rt-swatch" style={{ background: c }} />, `Highlight ${n.toLowerCase()}`, () => run("hiliteColor", c)))}
        {btn(<span className="rt-swatch rt-none">⌀</span>, "Remove highlight", () => run("hiliteColor", "transparent"))}
        <span className="rt-sep" />
        {COLORS.map(([c, n]) => btn(<span style={{ color: c, fontWeight: 700 }}>A</span>, `${n} text`, () => run("foreColor", c)))}
        {!compact && <>
          <span className="rt-sep" />
          {btn("H", "Heading", () => run("formatBlock", "h3"))}
          {btn("¶", "Normal text", () => run("formatBlock", "p"))}
          {btn("•", "Bulleted list", () => run("insertUnorderedList"))}
          {btn("1.", "Numbered list", () => run("insertOrderedList"))}
        </>}
        <span className="rt-sep" />
        {btn("🔗", "Link", () => { const url = window.prompt("Link address (https://…)"); if (url && /^(https?:\/\/|mailto:|tel:)/i.test(url.trim())) run("createLink", url.trim()); })}
        {btn("✕", "Clear formatting", () => run("removeFormat"))}
      </div>
      <div ref={ref} className="rt-area" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true"
        onInput={() => onChange(ref.current?.innerHTML ?? "")} onBlur={() => onChange(ref.current?.innerHTML ?? "")} />
    </div>
  );
}

// ---------- One block ----------
const KINDS: { type: Block["type"]; label: string; hint: string }[] = [
  { type: "text", label: "Text", hint: "Paragraphs with bold, highlight, underline, colors, lists and links" },
  { type: "callout", label: "Highlight box", hint: "A colored box for something agents must not miss" },
  { type: "facts", label: "Question & answer list", hint: "Label on the left, answer on the right" },
  { type: "table", label: "Table", hint: "Rows and columns, like pricing" },
  { type: "links", label: "Links", hint: "Buttons that open websites" },
];
function newBlock(type: Block["type"]): Block {
  const id = uid();
  if (type === "text") return { id, type, html: "" };
  if (type === "callout") return { id, type, tone: "important", html: "" };
  if (type === "facts") return { id, type, rows: [{ label: "", value: "" }] };
  if (type === "table") return { id, type, head: ["Item", "Details"], rows: [["", ""]] };
  return { id, type: "links", items: [{ label: "", url: "" }] };
}

function BlockEditor({ b, set }: { b: Block; set: (b: Block) => void }) {
  if (b.type === "text") return <RichText value={b.html} onChange={(html) => set({ ...b, html })} />;
  if (b.type === "callout") return (
    <>
      <div className="sb-tones">{TONES.map((t) => <button key={t.value} type="button" className={`sb-tone ${t.value}`} aria-pressed={b.tone === t.value} onClick={() => set({ ...b, tone: t.value as Tone })}>{t.label}</button>)}</div>
      <RichText value={b.html} onChange={(html) => set({ ...b, html })} />
    </>
  );
  if (b.type === "facts") return (
    <div className="sb-grid">
      {b.rows.map((r, i) => (
        <div key={i} className="sb-fact">
          <input className="x-input" value={r.label} placeholder="Label, e.g. Tire brands" onChange={(e) => set({ ...b, rows: b.rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
          <RichText compact value={r.value} onChange={(value) => set({ ...b, rows: b.rows.map((x, j) => (j === i ? { ...x, value } : x)) })} />
          <button type="button" className="x-btn" aria-label="Remove row" onClick={() => set({ ...b, rows: b.rows.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button type="button" className="x-btn" onClick={() => set({ ...b, rows: [...b.rows, { label: "", value: "" }] })}>+ Add a row</button>
    </div>
  );
  if (b.type === "table") return (
    <div className="sb-table-wrap">
      <table className="sb-table">
        <thead><tr>{b.head.map((h, c) => (
          <th key={c}><input className="x-input" value={h} placeholder={`Column ${c + 1}`} onChange={(e) => set({ ...b, head: b.head.map((x, j) => (j === c ? e.target.value : x)) })} />
            {b.head.length > 1 && <button type="button" aria-label="Remove column" onClick={() => set({ ...b, head: b.head.filter((_, j) => j !== c), rows: b.rows.map((r) => r.filter((_, j) => j !== c)) })}>✕</button>}</th>
        ))}<th /></tr></thead>
        <tbody>{b.rows.map((r, i) => (
          <tr key={i}>{b.head.map((_, c) => <td key={c}><input className="x-input" value={r[c] ?? ""} onChange={(e) => set({ ...b, rows: b.rows.map((x, j) => (j === i ? b.head.map((__, k) => (k === c ? e.target.value : x[k] ?? "")) : x)) })} /></td>)}
            <td><button type="button" className="x-btn" aria-label="Remove row" onClick={() => set({ ...b, rows: b.rows.filter((_, j) => j !== i) })}>✕</button></td></tr>
        ))}</tbody>
      </table>
      <div className="x-filters" style={{ marginTop: 6 }}>
        <button type="button" className="x-btn" onClick={() => set({ ...b, rows: [...b.rows, b.head.map(() => "")] })}>+ Row</button>
        {b.head.length < 8 && <button type="button" className="x-btn" onClick={() => set({ ...b, head: [...b.head, ""], rows: b.rows.map((r) => [...r, ""]) })}>+ Column</button>}
      </div>
    </div>
  );
  return (
    <div className="sb-grid">
      {b.items.map((l, i) => (
        <div key={i} className="sb-link">
          <input className="x-input" value={l.label} placeholder="Button text, e.g. Book online" onChange={(e) => set({ ...b, items: b.items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
          <input className="x-input" value={l.url} placeholder="https://…" onChange={(e) => set({ ...b, items: b.items.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
          <button type="button" className="x-btn" aria-label="Remove link" onClick={() => set({ ...b, items: b.items.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button type="button" className="x-btn" onClick={() => set({ ...b, items: [...b.items, { label: "", url: "" }] })}>+ Add a link</button>
    </div>
  );
}

// ---------- The whole section ----------
export function StoreSectionForm({ action, initial }: { action: (s: Result, f: FormData) => Promise<Result>; initial?: unknown }) {
  const [state, formAction, pending] = useActionState(action, {});
  const start = initial ? normalizeSection(initial) : null;
  const [title, setTitle] = useState(start?.title ?? "");
  const [style, setStyle] = useState<Style>(start?.style ?? "standard");
  const [blocks, setBlocks] = useState<Block[]>(start?.blocks.length ? start.blocks.map((b) => ({ ...b, id: b.id || uid() })) : [newBlock("text")]);
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= blocks.length) return; const n = [...blocks]; [n[i], n[j]] = [n[j], n[i]]; setBlocks(n); };

  return (
    <form action={formAction} className="ss-form">
      <input type="hidden" name="section" value={JSON.stringify({ title, style, blocks })} />
      <label className="ss-label">Section name
        <input className="x-input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Tire center, Holiday hours, Loaner rules" />
      </label>
      <span className="ss-label">Look</span>
      <div className="sb-styles" role="radiogroup" aria-label="Section look">
        {STYLES.map((s) => (
          <button key={s.value} type="button" role="radio" aria-checked={style === s.value} className={`sb-style ${s.value}`} onClick={() => setStyle(s.value)}>
            <strong>{s.label}</strong><small>{s.hint}</small>
          </button>
        ))}
      </div>
      <span className="ss-label" style={{ marginTop: 12 }}>Content</span>
      <ol className="sb-blocks">
        {blocks.map((b, i) => (
          <li key={b.id} className="sb-block">
            <div className="sb-block-head">
              <strong>{KINDS.find((k) => k.type === b.type)?.label}</strong>
              <span className="x-filters">
                {i > 0 && <button type="button" className="x-btn" onClick={() => move(i, -1)} aria-label="Move up">↑</button>}
                {i < blocks.length - 1 && <button type="button" className="x-btn" onClick={() => move(i, 1)} aria-label="Move down">↓</button>}
                <button type="button" className="x-btn" onClick={() => setBlocks(blocks.filter((x) => x.id !== b.id))}>Remove</button>
              </span>
            </div>
            <BlockEditor b={b} set={(nb) => setBlocks(blocks.map((x) => (x.id === b.id ? nb : x)))} />
          </li>
        ))}
      </ol>
      <div className="sb-add">
        <span>Add:</span>
        {KINDS.map((k) => <button key={k.type} type="button" className="x-btn" title={k.hint} onClick={() => setBlocks([...blocks, newBlock(k.type)])}>+ {k.label}</button>)}
      </div>
      {state.error && <p role="alert" className="text-sm" style={{ color: "#b42318", marginTop: 8 }}>{state.error}</p>}
      {state.ok && <p role="status" className="text-sm" style={{ color: "#15803d", marginTop: 8 }}>Saved. It shows on this store&apos;s Service Data page.</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="x-btn x-btn-primary" disabled={pending || !title.trim()}>{pending ? "Saving…" : "Save section"}</button>
      </div>
    </form>
  );
}
