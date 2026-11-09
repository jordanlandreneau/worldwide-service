import Link from "next/link";
import type React from "react";
import { CopyCode } from "@/components/copy-code";
import { Card, Page, Table } from "@/components/ui";
import { atLeast, requireUser } from "@/lib/access";
import { Field, InlineForm } from "@/components/action-form";
import { linkCodeLine } from "@/lib/code-actions";
import { fetchAll } from "@/lib/data";
import { CodesRefresher } from "@/components/codes-refresher";
import { cachedAll, db } from "@/lib/data";
import { codeCutoff } from "@/lib/justcall";

export const metadata = { title: "Codes · Worldwide Service" };
const PER_PAGE = 50;
const when = (v: string) => new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "America/New_York" });

export default async function Codes({ searchParams }: { searchParams: Promise<{ d?: string; from?: string; to?: string; page?: string }> }) {
  const user = await requireUser();
  const admin = atLeast(user.role, "admin");
  const { d = "", from = "", to = "", page = "1" } = await searchParams;
  const current = Math.max(1, Number(page) || 1);
  let query = db().from("verification_codes").select("*", { count: "exact" }).gte("sms_at", codeCutoff()).order("sms_at", { ascending: false }).range((current - 1) * PER_PAGE, current * PER_PAGE - 1);
  if (/^[0-9a-f-]{36}$/i.test(d)) query = query.eq("dealership_id", d);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("sms_at", `${from}T00:00:00-05:00`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("sms_at", `${to}T23:59:59-05:00`);
  const [{ data, count }, stores] = await Promise.all([query, cachedAll("dealerships", "id,name,active", "name")]);
  const { data: newest } = await db().from("verification_codes").select("sms_at").gte("sms_at", codeCutoff()).order("sms_at", { ascending: false }).limit(1).maybeSingle();
  const names = new Map(stores.map((s) => [s.id as string, s.name as string]));
  const rows = (data ?? []) as any[];
  // Admins: lines with codes but no store yet, and active stores with no line for codes.
  let setup: React.ReactNode = null;
  if (admin && current === 1 && !d) {
    const [{ data: loose }, all, lines] = await Promise.all([
      db().from("verification_codes").select("justcall_number,line_name,sms_at").is("dealership_id", null).gte("sms_at", codeCutoff()).limit(1000),
      fetchAll<any>("dealerships", "id,name,active,just_call_number", "name"),
      fetchAll<any>("dealership_departments", "dealership_id,just_call_number", "dealership_id"),
    ]);
    const active = all.filter((x: any) => x.active !== false);
    const hasLine = new Set([...all.filter((x: any) => x.just_call_number).map((x: any) => x.id), ...lines.filter((l: any) => l.just_call_number).map((l: any) => l.dealership_id)]);
    const noLine = active.filter((x: any) => !hasLine.has(x.id));
    const groups = new Map<string, { number: string; name: string | null; count: number; last: string }>();
    for (const c of (loose ?? []) as any[]) {
      const k = String(c.justcall_number ?? "").replace(/\D/g, "").slice(-10);
      if (k.length !== 10) continue;
      const g = groups.get(k) ?? { number: c.justcall_number, name: c.line_name, count: 0, last: c.sms_at };
      g.count += 1; if (c.sms_at > g.last) g.last = c.sms_at;
      groups.set(k, g);
    }
    const words = (v: string) => new Set(v.toLowerCase().replace(/\(.*?\)/g, " ").split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !["service", "the", "and", "of"].includes(w)));
    const guess = (name: string | null) => {
      if (!name) return "";
      const a = words(name);
      let best = { id: "", score: 0 };
      for (const st of active) { const b = words(st.name); let n = 0; for (const w of a) if (b.has(w)) n++; if (n > best.score) best = { id: st.id, score: n }; }
      return best.score >= 1 ? best.id : "";
    };
    const loneLines = [...groups.entries()].sort((x, y) => y[1].last.localeCompare(x[1].last));
    if (loneLines.length || noLine.length) setup = (
      <Card title="Code setup (admins only)" note="Every code in the JustCall inbox comes through. Codes on a line that isn't linked to a store show the line's name instead of a store until it's linked.">
        {loneLines.length > 0 && <>
          <h3 className="text-sm" style={{ fontWeight: 600, margin: "4px 0 8px" }}>Lines with codes but no store ({loneLines.length})</h3>
          <div className="x-stack">
            {loneLines.map(([k, g]) => (
              <div key={k} className="cd-line">
                <div><strong>{g.name ?? "Unnamed line"}</strong><small>{g.number} · {g.count} {g.count === 1 ? "code" : "codes"} today · last {when(g.last)}</small></div>
                <InlineForm action={linkCodeLine.bind(null, k)} submit="Link line">
                  <Field label="Store"><select className="x-input" name="store" defaultValue={guess(g.name)} required><option value="">Choose the store…</option>{active.map((st: any) => <option key={st.id} value={st.id}>{st.name}</option>)}</select></Field>
                </InlineForm>
              </div>
            ))}
          </div>
        </>}
        {noLine.length > 0 && <>
          <h3 className="text-sm" style={{ fontWeight: 600, margin: "14px 0 6px" }}>Active stores with no JustCall line for codes ({noLine.length})</h3>
          <p className="text-sm text-ink-muted" style={{ marginBottom: 6 }}>Codes for these stores can't be labeled until their line is linked: above, once a code arrives, or on the store page.</p>
          <p className="text-sm">{noLine.map((x: any, i: number) => <span key={x.id}>{i > 0 && " · "}<Link className="text-accent" href={`/stores/${x.id}`}>{x.name}</Link></span>)}</p>
        </>}
      </Card>
    );
  }
  const pageLink = (n: number) => `/codes?${new URLSearchParams({ ...(d && { d }), ...(from && { from }), ...(to && { to }), page: String(n) })}`;
  return (
    <Page title="Codes" subtitle={`CRM verification codes received on dealership JustCall lines. · ${rows.length} on page · ${(count ?? 0).toLocaleString()} from the last 24 hours`} actions={<Link className="x-btn" href={pageLink(current)} style={{ display: "inline-flex", alignItems: "center" }}>Refresh</Link>}>
      {rows[0] && current === 1 && <section className="x-latest" aria-label="Latest code"><span>Latest</span><CopyCode code={rows[0].code} /><div><strong>{rows[0].dealership_id ? names.get(rows[0].dealership_id) ?? "—" : rows[0].line_name ?? "—"}</strong><small>{when(rows[0].sms_at)} from {rows[0].contact_number ?? "—"}</small><p className="x-prewrap">{rows[0].body}</p></div></section>}
      {setup}
      <CodesRefresher latest={(newest?.sms_at as string | undefined) ?? null} />
      <Card>
        <form className="x-filters">
          <select className="x-input" name="d" defaultValue={d} aria-label="Dealership lookup"><option value="">All dealerships</option>{stores.filter((s: any) => s.active !== false).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <label className="text-sm">From <input className="x-input" type="date" name="from" defaultValue={from} /></label>
          <label className="text-sm">To <input className="x-input" type="date" name="to" defaultValue={to} /></label>
          <button className="x-btn x-btn-primary">Apply</button>
        </form>
      </Card>
      <Card>
        <Table
          head={["Code", "Dealership", "When", "From", "Message"]}
          empty="No codes yet."
          rows={rows.map((r) => [
            <CopyCode key="c" code={r.code} />,
            r.dealership_id ? names.get(r.dealership_id) ?? "—" : r.line_name ?? r.justcall_number ?? "—",
            when(r.sms_at),
            r.contact_name || r.contact_number || "—",
            <span key="m" className="x-prewrap">{r.body}</span>,
          ])}
        />
        <div className="x-filters" style={{ marginTop: 12 }}>
          {current > 1 && <Link className="x-btn" href={pageLink(current - 1)} style={{ display: "inline-flex", alignItems: "center" }}>Previous</Link>}
          {current * PER_PAGE < (count ?? 0) && <Link className="x-btn" href={pageLink(current + 1)} style={{ display: "inline-flex", alignItems: "center" }}>Next</Link>}
        </div>
      </Card>
    </Page>
  );
}
