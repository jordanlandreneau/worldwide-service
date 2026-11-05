"use client";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

// Filters the guide's sections as you type, like the BMW guide's search. Press / to jump here.
export function SectionSearch() {
  const [q, setQ] = useState("");
  const [none, setNone] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); box.current?.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    const term = q.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll<HTMLElement>(".svc-content .svc-section").forEach((el) => {
      const hit = !term || (el.textContent ?? "").toLowerCase().includes(term);
      el.hidden = !hit;
      if (hit) shown++;
    });
    setNone(!!term && shown === 0);
  }, [q]);
  return (
    <>
      <label className="svc-search">
        <Search size={16} aria-hidden />
        <input ref={box} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the guide  ( / )" aria-label="Search the guide" autoComplete="off" />
      </label>
      {none && <p className="svc-search-none">Nothing matches “{q}”.</p>}
    </>
  );
}
