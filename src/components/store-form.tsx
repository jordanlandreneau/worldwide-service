import { Field } from "@/components/action-form";

export const ZONES: [string, string][] = [
  ["America/New_York", "Eastern"], ["America/Chicago", "Central"], ["America/Denver", "Mountain"], ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"], ["America/Anchorage", "Alaska"], ["Pacific/Honolulu", "Hawaii"],
];

// The store's own details. Service Data (pricing, contacts, notes) is filled in on Service Admin.
export function StoreFields({ s, serviceLine }: { s?: Record<string, any>; serviceLine?: string | null }) {
  const input = (name: string, label: string, value?: unknown, placeholder?: string, type = "text") => (
    <Field label={label}><input className="x-input" name={name} type={type} defaultValue={value == null ? "" : String(value)} placeholder={placeholder} /></Field>
  );
  return (
    <>
      <div className="cc-form-grid">
        <Field label="Store name"><input className="x-input" name="name" required defaultValue={s?.name ?? ""} placeholder="e.g. Eagle Ridge GMC" /></Field>
        <Field label="Time zone">
          <select className="x-input" name="timezone" defaultValue={s?.timezone ?? "America/New_York"}>{ZONES.map(([z, n]) => <option key={z} value={z}>{n} ({z})</option>)}</select>
        </Field>
      </div>
      {input("address", "Address", s?.address, "Street, city, state ZIP")}
      <div className="cc-form-grid">
        {input("phone", "Store phone", s?.phone)}
        {input("website", "Website", s?.website, "https://")}
      </div>
      <div className="cc-form-grid">
        {input("just_call_number", "JustCall number codes are sent to (store line)", s?.just_call_number, "The JustCall line that receives this store's codes")}
        {input("service_just_call_number", "JustCall number (Service line)", serviceLine, "If Service has its own line")}
      </div>
      <div className="cc-form-grid">
        {input("code_sender_number", "Number codes are routed from", s?.code_sender_number, "The CRM's or forwarder's number the code texts come from")}
        <span />
      </div>
      <div className="cc-form-grid">
        {input("agent_code_number", "Agent code number", s?.agent_code_number)}
        {input("logo_url", "Logo link (optional)", s?.logo_url, "https://")}
      </div>
      <Field label="Special note (optional)"><textarea className="x-input" name="special_note" defaultValue={s?.special_note ?? ""} style={{ height: 90, padding: 10 }} /></Field>
      {s && <label style={{ display: "flex", gap: 8, fontSize: 14, marginBottom: 12 }}><input type="checkbox" name="active" defaultChecked={s.active !== false} /> Active (inactive stores are hidden from the pickers)</label>}
    </>
  );
}
