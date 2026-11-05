"use client";
import { useEffect, useState } from "react";

// The store's own time, like the BMW guide's header clock.
export function LiveClock({ timeZone }: { timeZone?: string | null }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  const zone = timeZone || "America/New_York";
  const fmt = (o: Intl.DateTimeFormatOptions) => { try { return now ? new Intl.DateTimeFormat("en-US", { timeZone: zone, ...o }).format(now) : ""; } catch { return ""; } };
  return (
    <div className="svc-clock" aria-live="off">
      <span className="svc-clock-time">{fmt({ hour: "numeric", minute: "2-digit" }) || " "}</span>
      <span className="svc-clock-date">{fmt({ weekday: "long", month: "long", day: "numeric" })}{now ? ` · ${fmt({ timeZoneName: "short" }).split(" ").pop()} store time` : ""}</span>
    </div>
  );
}
