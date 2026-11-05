import { CredentialsPanel } from "@/components/credentials-panel";
import { HoursGrid } from "@/components/hours-grid";
import type React from "react";
import { Card, External, Field, Status, Table } from "@/components/ui";
import type { loadDealership } from "@/lib/data";

const yes = (v: unknown) => (v ? "Yes" : "No");

function localTime(tz?: string | null) {
  if (!tz) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(new Date());
  } catch {
    return null;
  }
}

export function StoreRecord({ data, context }: { data: NonNullable<Awaited<ReturnType<typeof loadDealership>>>; context: "info" | "manage" }) {
  const { store: s, deptName, links, contacts, hours, rules, credentials } = data;
  const name = (id: string | null) => (id ? deptName.get(id) ?? "—" : "—");
  const logo = /^https:\/\//i.test(String(s.logo_url ?? "")) ? (s.logo_url as string) : null;
  return (
    <>
      <Card title="Store">
        <div className="x-store-id">
          {logo && <div className="x-logo-box">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={logo} alt={`${s.name} logo`} referrerPolicy="no-referrer" /></div>}
          <div><strong>{s.name}</strong>{s.phone && <small>{s.phone}</small>}</div>
        </div>
        <Field items={[
          ["Status", <Status key="s" value={s.status ?? s.active} />],
          ["Team", s.team_name], ["Source", s.source], ["Timezone", `${s.timezone ?? "—"}${localTime(s.timezone) ? ` · ${localTime(s.timezone)}` : ""}`],
          ["Store line", s.phone], ["Website", <External key="w" href={s.website} />], ...(context === "manage" ? [["Logo URL", <External key="l" href={s.logo_url} />] as [string, React.ReactNode]] : []), ["Address", s.address],
          ["Sales required", yes(s.sales_required)], ["Service required", yes(s.service_required)], ["Data mining required", yes(s.data_mining_required)],
        ]} />
      </Card>
      <Card title="CRM credentials" note={context === "info" ? "Acknowledge each store rule below before revealing passwords." : "Shared logins by department. Passwords are masked until revealed."}>
        <CredentialsPanel context={context} rules={rules} credentials={credentials} deptName={Object.fromEntries(deptName)} />
      </Card>
      <Card title="Instructions">
        <Field items={[["CRM", <span key="c" className="x-prewrap">{s.crm_instructions}</span>], ["Special note", <span key="n" className="x-prewrap">{s.special_note}</span>]]} />
      </Card>
      <Card title="Calling and messaging">
        <Field items={[
          ["JustCall number", s.just_call_number], ["Campaign number", s.just_call_campaign_number], ["Voicemail ID", s.just_call_voicemail_id],
          ["Sales dial", s.sales_dial_number], ["Sales text", s.sales_text_number], ["Agent code", s.agent_code_number],
          ["Assign to", s.assign_to_name], ["VIP manager 1", s.vip_manager_1_name], ["VIP manager 2", s.vip_manager_2_name],
        ]} />
      </Card>
      <Card title="Departments">
        <Table head={["Department", "Status", "Goal", "Transfer", "JustCall"]} rows={links.map((l) => [name(l.department_id), <Status key="a" value={l.active} />, l.goal ?? "—", l.transfer_number ?? "—", l.just_call_number ?? "—"])} />
      </Card>
      {context === "info" && <Card title="Contacts" note="Store contacts by department.">
        <Table head={["Name", "Phone", "Department", "Status"]} rows={contacts.map((c) => [c.name ?? "—", c.phone ?? "—", name(c.department_id), <Status key="a" value={c.active} />])} empty="No contacts." />
      </Card>}
      {context === "info" && <Card title="Store hours" note="Times are the store's local time.">
        <HoursGrid timeZone={s.timezone} rows={hours.map((h) => ({ department: name(h.department_id), day: h.day_of_week, closed: h.closed, open: h.open_time, close: h.close_time }))} />
      </Card>}
    </>
  );
}
