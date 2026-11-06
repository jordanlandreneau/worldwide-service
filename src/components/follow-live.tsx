"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Pulls new replies in the background (right away, then every 20 seconds while the tab is visible)
// and refreshes the page only when something new arrived. The page never waits on the chat apps.
export function LiveSync() {
  const router = useRouter();
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/follow-up/sync", { method: "POST" });
        const body = (await res.json()) as { added?: number };
        if (!stop && body.added) router.refresh();
      } catch { /* next tick */ }
    };
    tick();
    const t = setInterval(tick, 20_000);
    const onShow = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { stop = true; clearInterval(t); document.removeEventListener("visibilitychange", onShow); };
  }, [router]);
  return null;
}
