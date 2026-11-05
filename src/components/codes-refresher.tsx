"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { refreshCodes } from "@/lib/code-actions";

const EVERY_MS = 30_000;

// The page shows stored codes at once, and JustCall is checked here without holding it up.
export function CodesRefresher({ latest }: { latest: string | null }) {
  const router = useRouter();
  const shown = useRef(latest);
  shown.current = latest;
  const [state, setState] = useState<{ checking: boolean; error?: string }>({ checking: true });
  useEffect(() => {
    let live = true;
    let first = true;
    async function check() {
      // The first check always runs, then a tab in the background waits until it's looked at.
      if (document.hidden && !first) return;
      first = false;
      setState((s) => ({ ...s, checking: true }));
      try {
        const r = await refreshCodes();
        if (!live) return;
        setState({ checking: false, error: r.error });
        if (r.latest !== shown.current) router.refresh();
      } catch {
        if (live) setState({ checking: false, error: "Couldn't check for new codes." });
      }
    }
    check();
    const timer = setInterval(check, EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", check); };
  }, [router]);
  return <p className={state.error ? "x-alert" : "x-note"} role="status">{state.error ? `${state.error} Showing the codes already stored.` : state.checking ? "Checking JustCall for new codes…" : "Up to date. Checks for new codes every 30 seconds."}</p>;
}
