// Store-only Service Data sections are made of blocks the admin arranges freely.
// Shared by the editor (client) and the server, so no server-only imports here.
export type Block =
  | { id: string; type: "text"; html: string }
  | { id: string; type: "facts"; rows: { label: string; value: string }[] }
  | { id: string; type: "table"; head: string[]; rows: string[][] }
  | { id: string; type: "links"; items: { label: string; url: string }[] }
  | { id: string; type: "callout"; tone: Tone; html: string };
export type Tone = "info" | "important" | "warning" | "success";
export type Style = "standard" | "important" | "announcement" | "note" | "success";
export type StoreSection = { id: string; title: string; style: Style; blocks: Block[] };

export const STYLES: { value: Style; label: string; hint: string }[] = [
  { value: "standard", label: "Standard", hint: "Plain section like the others" },
  { value: "important", label: "Important", hint: "Dark with a red edge, like the Important box" },
  { value: "announcement", label: "Announcement", hint: "Blue banner that stands out" },
  { value: "note", label: "Note", hint: "Soft yellow for reminders" },
  { value: "success", label: "Good to know", hint: "Soft green for helpful tips" },
];
export const TONES: { value: Tone; label: string }[] = [
  { value: "info", label: "Info (blue)" }, { value: "important", label: "Important (red)" }, { value: "warning", label: "Warning (yellow)" }, { value: "success", label: "Good news (green)" },
];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Turns sections saved before blocks existed (question / answer rows) into the block format.
export function normalizeSection(s: any): StoreSection {
  const style = STYLES.some((x) => x.value === s?.style) ? s.style : "standard";
  if (Array.isArray(s?.blocks)) return { id: String(s.id), title: String(s.title ?? ""), style, blocks: s.blocks };
  const rows = Array.isArray(s?.rows) ? s.rows : [];
  return { id: String(s?.id), title: String(s?.title ?? ""), style, blocks: rows.length ? [{ id: "legacy", type: "facts", rows }] : [] };
}

// Allow-list HTML cleaner for the rich text blocks: formatting only, no scripts, styles limited to colors.
const TAGS = new Set(["b", "strong", "i", "em", "u", "s", "mark", "span", "p", "div", "br", "ul", "ol", "li", "h3", "h4", "a", "font", "blockquote"]);
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i;
export function cleanHtml(input: string): string {
  const html = String(input ?? "").slice(0, 50000);
  let out = "";
  const stack: string[] = [];
  const re = /<\/?([a-zA-Z0-9]+)([^>]*)>|<!--[\s\S]*?-->|([^<]+)|</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[3] !== undefined) { out += m[3].replace(/>/g, "&gt;"); continue; }
    if (!m[1]) { if (m[0] === "<") out += "&lt;"; continue; }
    const tag = m[1].toLowerCase();
    const closing = m[0].startsWith("</");
    if (!TAGS.has(tag)) continue;
    const t = tag === "font" ? "span" : tag;
    if (closing) {
      const i = stack.lastIndexOf(t);
      if (i >= 0) { while (stack.length > i) out += `</${stack.pop()}>`; }
      continue;
    }
    if (t === "br") { out += "<br>"; continue; }
    const attrs = m[2] ?? "";
    let a = "";
    const style: string[] = [];
    const styleAttr = attrs.match(/style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/i);
    for (const decl of (styleAttr?.[1] ?? styleAttr?.[2] ?? "").split(";")) {
      const [k, v] = decl.split(":").map((x) => x?.trim() ?? "");
      if (/^(color|background-color)$/i.test(k) && COLOR.test(v)) style.push(`${k.toLowerCase()}: ${v}`);
      if (/^font-weight$/i.test(k) && /^(bold|[5-9]00)$/.test(v)) style.push("font-weight: 700");
      if (/^text-decoration(-line)?$/i.test(k) && /underline|line-through/.test(v)) style.push(`text-decoration: ${v.match(/underline|line-through/)![0]}`);
      if (/^font-style$/i.test(k) && v === "italic") style.push("font-style: italic");
    }
    if (tag === "font") {
      const c = attrs.match(/color\s*=\s*"?([^"\s>]+)/i)?.[1];
      if (c && COLOR.test(c)) style.push(`color: ${c}`);
    }
    if (style.length) a += ` style="${esc(style.join("; "))}"`;
    if (t === "a") {
      const href = attrs.match(/href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i);
      const url = (href?.[1] ?? href?.[2] ?? "").trim();
      if (!/^(https?:\/\/|mailto:|tel:)/i.test(url)) continue;
      a += ` href="${esc(url)}" target="_blank" rel="noopener noreferrer"`;
    }
    out += `<${t}${a}>`;
    stack.push(t);
  }
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}

export function cleanSection(raw: any): StoreSection | string {
  const s = normalizeSection(raw);
  const title = s.title.trim().slice(0, 120);
  if (!title) return "Give the section a name.";
  const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  const blocks: Block[] = [];
  for (const b of (Array.isArray(raw?.blocks) ? raw.blocks : s.blocks).slice(0, 40)) {
    const id = clip(b?.id, 40) || Math.random().toString(36).slice(2);
    if (b?.type === "text") blocks.push({ id, type: "text", html: cleanHtml(b.html) });
    else if (b?.type === "callout") blocks.push({ id, type: "callout", tone: TONES.some((t) => t.value === b.tone) ? b.tone : "info", html: cleanHtml(b.html) });
    else if (b?.type === "facts") blocks.push({ id, type: "facts", rows: (b.rows ?? []).slice(0, 100).map((r: any) => ({ label: clip(r?.label, 200), value: cleanHtml(r?.value) })).filter((r: any) => r.label || r.value) });
    else if (b?.type === "table") {
      const head = (b.head ?? []).slice(0, 8).map((h: unknown) => clip(h, 100));
      blocks.push({ id, type: "table", head, rows: (b.rows ?? []).slice(0, 200).map((r: unknown[]) => head.map((_: string, i: number) => clip(r?.[i], 500))).filter((r: string[]) => r.some(Boolean)) });
    } else if (b?.type === "links") {
      blocks.push({ id, type: "links", items: (b.items ?? []).slice(0, 30).map((l: any) => ({ label: clip(l?.label, 120), url: clip(l?.url, 1000).trim() })).filter((l: any) => /^(https?:\/\/|mailto:|tel:)/i.test(l.url)) });
    }
  }
  return { id: s.id, title, style: s.style, blocks };
}
