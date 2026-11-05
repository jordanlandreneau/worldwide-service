"use client";
import { useMemo, useState } from "react";
import { BookOpen, Languages, Search } from "lucide-react";
import { ActionButton, Field, ModalForm } from "@/components/action-form";
import { deleteTerm, saveTerm } from "@/lib/reference";

export type Term = { id: string; kind: "glossary" | "dictionary"; term: string; meaning: string };
const TABS = [["glossary", "Automotive Glossary", BookOpen], ["dictionary", "Spanish ↔ English Dictionary", Languages]] as const;
const letterOf = (t: string) => {
  const c = t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^[^A-Za-z0-9]+/, "").charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
};

function TermFields({ kind, t }: { kind: Term["kind"]; t?: Term }) {
  return kind === "dictionary" ? (
    <>
      <Field label="Spanish"><input className="x-input" name="term" required defaultValue={t?.term ?? ""} /></Field>
      <Field label="English"><input className="x-input" name="meaning" required defaultValue={t?.meaning ?? ""} /></Field>
    </>
  ) : (
    <>
      <Field label="Term"><input className="x-input" name="term" required defaultValue={t?.term ?? ""} /></Field>
      <Field label="Definition"><textarea className="x-input" name="meaning" required defaultValue={t?.meaning ?? ""} style={{ height: 180, padding: 10 }} /></Field>
    </>
  );
}

// The Reference Library: search, two lists, a letter strip, and (for managers and admins) add, edit and delete.
export function ReferenceLibrary({ terms, canEdit }: { terms: Term[]; canEdit: boolean }) {
  const [tab, setTab] = useState<Term["kind"]>("glossary");
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const list = useMemo(() => terms
    .filter((t) => t.kind === tab)
    .filter((t) => !term || t.term.toLowerCase().includes(term) || t.meaning.toLowerCase().includes(term))
    .sort((a, b) => a.term.localeCompare(b.term, "es", { sensitivity: "base" })), [terms, tab, term]);
  const groups = useMemo(() => {
    const m = new Map<string, Term[]>();
    for (const t of list) { const k = letterOf(t.term); m.set(k, [...(m.get(k) ?? []), t]); }
    return [...m].sort(([a], [b]) => (a === "#" ? -1 : b === "#" ? 1 : a.localeCompare(b)));
  }, [list]);
  const count = (k: Term["kind"]) => terms.filter((t) => t.kind === k).length;

  return (
    <div className="ref">
      <div className="ref-tools">
        <label className="ref-search">
          <Search size={16} aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search terms and translations…" aria-label="Search terms and translations" />
        </label>
        {canEdit && (
          <span className="ref-add">
            <ModalForm button={tab === "dictionary" ? "+ Add translation" : "+ Add term"} title={tab === "dictionary" ? "Add a translation" : "Add a glossary term"} submit="Add" action={saveTerm.bind(null, tab, null)}>
              <TermFields kind={tab} />
            </ModalForm>
          </span>
        )}
      </div>
      <div className="ref-tabs" role="tablist">
        {TABS.map(([k, label, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} data-active={tab === k} onClick={() => setTab(k)}>
            <Icon size={16} aria-hidden /> {label} <small>{count(k)}</small>
          </button>
        ))}
      </div>
      {groups.length > 1 && (
        <nav className="ref-letters" aria-label="Jump to letter">
          {groups.map(([k]) => <a key={k} href={`#ref-${tab}-${k}`}>{k}</a>)}
        </nav>
      )}
      {!list.length && <p className="ref-none">{term ? `Nothing matches “${q}”.` : "No terms yet."}</p>}
      {groups.map(([k, items]) => (
        <section key={k} id={`ref-${tab}-${k}`} className="ref-group">
          <h3>{k}</h3>
          {tab === "glossary" ? (
            <div className="ref-list">
              {items.map((t) => (
                <details key={t.id} open={!!term}>
                  <summary>{t.term}</summary>
                  <div className="ref-body">
                    <p className="x-prewrap">{t.meaning}</p>
                    {canEdit && (
                      <div className="ref-actions">
                        <ModalForm button="Edit" title={`Edit ${t.term}`} action={saveTerm.bind(null, "glossary", t.id)}><TermFields kind="glossary" t={t} /></ModalForm>
                        <ActionButton label="Delete" confirm={`Delete ${t.term}?`} action={deleteTerm.bind(null, t.id)} />
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <div className="ref-grid">
              {items.map((t) => (
                <article key={t.id} className="ref-pair">
                  <strong>{t.term}</strong>
                  <span>{t.meaning}</span>
                  {canEdit && (
                    <div className="ref-actions">
                      <ModalForm button="Edit" title={`Edit ${t.term}`} action={saveTerm.bind(null, "dictionary", t.id)}><TermFields kind="dictionary" t={t} /></ModalForm>
                      <ActionButton label="Delete" confirm={`Delete ${t.term}?`} action={deleteTerm.bind(null, t.id)} />
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
