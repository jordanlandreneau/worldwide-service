"use client";
import { Check, Copy, Moon, Sun } from "lucide-react";
import { useState } from "react";

// Light / dark switch for the Follow-ups workspace, remembered in a cookie.
export function ThemeToggle({ initial }: { initial: "light" | "dark" }) {
  const [theme, setTheme] = useState(initial);
  const flip = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.querySelector(".fu-app")?.setAttribute("data-theme", next);
    document.cookie = `fu_theme=${next}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <button type="button" className="fu-icon-btn" onClick={flip} aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"} title={theme === "light" ? "Dark mode" : "Light mode"}>
      {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  );
}

export function CopyButton({ value, label = "Copy ID" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); } catch {
      const t = document.createElement("textarea"); t.value = value; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
    }
    setDone(true); setTimeout(() => setDone(false), 1500);
  };
  return <button type="button" className="fu-ghost" onClick={copy}>{done ? <Check size={13} /> : <Copy size={13} />} {done ? "Copied" : label}</button>;
}
