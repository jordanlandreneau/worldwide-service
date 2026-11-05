"use client";
import { useState } from "react";
import { importTerms } from "@/lib/reference";

// One-time move of the glossary captured from 4.0 into editable terms. The dictionary comes along too.
export function ReferenceImport({ html }: { html: string }) {
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});
  async function run() {
    setState({ busy: true });
    const doc = new DOMParser().parseFromString(html, "text/html");
    const glossary = [...doc.querySelectorAll("details")].map((d) => {
      const term = d.querySelector("summary")?.textContent?.trim() ?? "";
      const body = d.querySelector("summary")?.nextElementSibling;
      const paragraphs = [...(body?.querySelectorAll("p, li") ?? [])].map((p) => (p.tagName === "LI" ? `• ${p.textContent?.trim()}` : p.textContent?.trim())).filter(Boolean);
      return { term, meaning: (paragraphs.length ? paragraphs.join("\n\n") : body?.textContent ?? "").trim() };
    }).filter((g) => g.term && g.meaning);
    const res = await importTerms(glossary);
    if (res.error) setState({ error: res.error });
    else window.location.reload();
  }
  return (
    <div className="ref-import">
      <p><strong>Make the Reference Library editable.</strong> This moves its glossary terms and the Spanish ↔ English dictionary into lists you can add to and edit. It only needs to be done once.</p>
      <button type="button" className="x-btn x-btn-primary" disabled={state.busy} onClick={run}>{state.busy ? "Moving…" : "Make editable"}</button>
      {state.error && <p role="alert" className="text-sm text-status-attention-ink">{state.error}</p>}
    </div>
  );
}
