"use client";
import { useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { withExtras } from "@/lib/service-extras";

// Shows service content captured from 3.0. Its own tab links work as normal page links.
// Button-based tabs (Reference Library) and Copy buttons are handled here.
function setOpen(button: HTMLElement, panel: HTMLElement, open: boolean) {
  button.setAttribute("aria-expanded", String(open));
  panel.hidden = !open;
  button.querySelector("svg")?.classList.toggle("rotate-180", open);
}

export function ServiceHtml({ html, tabs }: { html: string; tabs?: { label: string; html: string }[] | null }) {
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const source = tabs?.length ? tabs[active]?.html ?? html : html;
  const body = useMemo(() => withExtras(source), [source]);

  function onClick(e: MouseEvent<HTMLDivElement>) {
    const button = (e.target as HTMLElement).closest("button");
    if (!button) return;
    const label = button.innerText.trim();
    const panel = button.nextElementSibling as HTMLElement | null;
    if (button.hasAttribute("aria-expanded") && panel?.hasAttribute("data-panel")) {
      setOpen(button, panel, button.getAttribute("aria-expanded") !== "true");
      return;
    }
    if (button.getAttribute("role") === "tab" && tabs?.length) {
      const i = tabs.findIndex((t) => t.label === label);
      if (i >= 0) setActive(i);
      return;
    }
    if (label === "Copy") {
      const row = button.closest("tr, li, section, div");
      const text = (row as HTMLElement | null)?.innerText.replace(/\s*Copy\s*$/, "").trim();
      if (text) navigator.clipboard?.writeText(text);
      return;
    }
    if (/^[#A-Z]$/.test(label)) {
      const target = ref.current?.querySelector<HTMLElement>(`[id="glossary-letter-${label}"], [id="dictionary-letter-${label}"]`);
      const opener = target?.querySelector<HTMLElement>(":scope > button");
      const content = opener?.nextElementSibling as HTMLElement | null;
      if (opener && content?.hasAttribute("data-panel")) setOpen(opener, content, true);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // The copied search box has no code of its own, so it filters the terms here.
  function onInput(e: FormEvent<HTMLDivElement>) {
    const input = e.target as HTMLInputElement;
    if (input.tagName !== "INPUT" || !/search/i.test(input.placeholder) || !ref.current) return;
    const term = input.value.trim().toLowerCase();
    const items = [...ref.current.querySelectorAll<HTMLElement>("details, tbody tr, article[data-term]")];
    for (const item of items) item.hidden = !!term && !item.textContent?.toLowerCase().includes(term);
    for (const group of ref.current.querySelectorAll<HTMLElement>('section[id^="glossary-letter"]')) {
      group.hidden = !!term && !group.querySelector("details:not([hidden]), tbody tr:not([hidden])");
    }
    for (const group of ref.current.querySelectorAll<HTMLElement>('[id^="dictionary-letter-"]')) {
      const opener = group.querySelector<HTMLElement>(":scope > button");
      const content = opener?.nextElementSibling as HTMLElement | null;
      if (!opener || !content) continue;
      const found = !!group.querySelector("article[data-term]:not([hidden])");
      group.hidden = !!term && !found;
      setOpen(opener, content, !!term && found);
    }
    const bar = ref.current.querySelector<HTMLElement>("nav.sticky");
    if (bar) bar.hidden = !!term;
  }

  return <div ref={ref} className="x-captured" onClick={onClick} onInput={onInput} dangerouslySetInnerHTML={{ __html: body }} />;
}
