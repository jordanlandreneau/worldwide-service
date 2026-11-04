const WEEK = [["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 0]] as const;
export type HourRow = { department: string; day: number; closed: boolean; open: string | null; close: string | null };

export function clock(value: string | null | undefined) {
  const m = String(value ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return value || "—";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}
function todayIn(timeZone?: string | null) {
  const name = (zone?: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" }).format(new Date());
  let short: string;
  try { short = name(timeZone ?? "America/New_York"); } catch { short = name("America/New_York"); }
  return short;
}

// One row per department and one column per day, so departments and days compare at a glance.
export function HoursGrid({ rows, timeZone }: { rows: HourRow[]; timeZone?: string | null }) {
  if (!rows.length) return <p className="text-sm text-ink-muted">No hours set.</p>;
  const today = todayIn(timeZone);
  const names = [...new Set(rows.map((r) => r.department))].sort((a, b) => Number(b === "Service") - Number(a === "Service") || a.localeCompare(b));
  return (
    <div className="x-hours-wrap">
      <table className="x-hours">
        <thead><tr><th scope="col">Department</th>{WEEK.map(([d]) => <th key={d} scope="col" data-today={d === today}>{d}{d === today && <small>Today</small>}</th>)}</tr></thead>
        <tbody>
          {names.map((n) => (
            <tr key={n}>
              <th scope="row">{n}</th>
              {WEEK.map(([d, i]) => {
                const h = rows.find((r) => r.department === n && r.day === i);
                return (
                  <td key={d} data-today={d === today}>
                    {!h ? <span className="x-hours-none">—</span> : h.closed ? <span className="x-hours-closed">Closed</span> : <><b>{clock(h.open)}</b><span>{clock(h.close)}</span></>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
