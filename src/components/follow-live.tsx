"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Msg = { id: string; chatId: string; chat: string; channel: string; from: string; body: string; href?: string };
const link = (m: Msg) => m.href ?? `/follow-up?channel=${m.channel}&chat=${m.chatId}`;
const NAMES: Record<string, string> = { event: "Command Center", whatsapp: "WhatsApp", teams: "Teams", email: "Email", google_chat: "Google Chat", sms: "Text", slack: "Slack" };

// Runs on every page for agents and up. Every 15 seconds while the tab is open it pulls new store replies,
// pops up each new message (and a desktop alert when the tab is in the background, if allowed),
// and refreshes Follow-ups when it's open. Pages never wait on the chat apps.
export function LiveSync() {
  const router = useRouter();
  const path = usePathname();
  const pathRef = useRef(path);
  pathRef.current = path;
  const [toasts, setToasts] = useState<Msg[]>([]);
  useEffect(() => {
    let stop = false;
    let since: string | null = null;
    try { since = sessionStorage.getItem("fu_since"); } catch { /* storage off */ }
    const tick = async () => {
      try {
        const res = await fetch("/api/follow-up/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ since }) });
        if (!res.ok) return;
        const out = (await res.json()) as { added?: number; now?: string; messages?: Msg[] };
        if (stop) return;
        if (out.now) { since = out.now; try { sessionStorage.setItem("fu_since", out.now); } catch { /* storage off */ } }
        const fresh = out.messages ?? [];
        if (fresh.length) {
          setToasts((t) => [...t, ...fresh].slice(-4));
          for (const m of fresh) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== m.id)), m.channel === "event" ? 60000 : 15000);
          if (document.visibilityState !== "visible" && "Notification" in window && Notification.permission === "granted") {
            for (const m of fresh.slice(-3)) {
              const n = new Notification(`${m.chat} · ${m.from}`, { body: m.body, tag: m.id });
              n.onclick = () => { window.focus(); router.push(link(m)); n.close(); };
            }
          }
        }
        if ((out.added || fresh.length) && pathRef.current.startsWith("/follow-up")) router.refresh();
      } catch { /* next tick */ }
    };
    tick();
    const t = setInterval(() => { if (document.visibilityState === "visible" || ("Notification" in window && Notification.permission === "granted")) tick(); }, 15_000);
    return () => { stop = true; clearInterval(t); };
  }, [router]);

  if (!toasts.length) return null;
  return (
    <div className="fu-toasts" role="status" aria-live="polite">
      {toasts.map((m) => (
        <a key={m.id} className="fu-toast" data-ch={m.channel} href={link(m)}
          onClick={(e) => { e.preventDefault(); setToasts((t) => t.filter((x) => x.id !== m.id)); router.push(link(m)); }}>
          <span className="fu-toast-top"><strong>{m.chat}</strong>{NAMES[m.channel] ?? ""}
            <button type="button" aria-label="Dismiss" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setToasts((t) => t.filter((x) => x.id !== m.id)); }}>✕</button></span>
          <p>{m.body}</p>
          <small>{m.from} · click to open</small>
        </a>
      ))}
    </div>
  );
}

// Lets someone turn on desktop alerts for new store messages while the site is in a background tab.
export function DesktopAlerts() {
  const [state, setState] = useState<string>("unknown");
  useEffect(() => { setState("Notification" in window ? Notification.permission : "unsupported"); }, []);
  if (state === "unsupported" || state === "unknown") return null;
  if (state === "granted") return <p className="fu-alerts on">Desktop alerts are on</p>;
  if (state === "denied") return <p className="fu-alerts">Desktop alerts are blocked in this browser&apos;s site settings</p>;
  return <button type="button" className="fu-alerts-btn" onClick={async () => setState(await Notification.requestPermission())}>Turn on desktop alerts</button>;
}
