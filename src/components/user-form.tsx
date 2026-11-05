"use client";
import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import type { FormState } from "@/lib/users";

type Option = { id: string; name: string };
export type UserValues = { first_name: string; last_name: string; email: string; photo_url?: string | null; role: string; status?: string; team_id?: string | null; dealerships: string[] };

const label = "type-label text-ink-title";
const col = { display: "flex", flexDirection: "column", gap: 6 } as const;

export function UserForm({ mode, values, teams, stores, roles, action, submit }: {
  mode: "invite" | "edit";
  values?: UserValues;
  teams: Option[];
  stores: Option[];
  roles: string[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
  submit: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [role, setRole] = useState(values?.role ?? "agent");
  const [picked, setPicked] = useState<string[]>(values?.dealerships ?? []);
  const [q, setQ] = useState("");
  const list = useMemo(() => stores.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase())), [q, stores]);
  const names = new Map(stores.map((s) => [s.id, s.name]));
  return (
    <form action={formAction} className="x-stack">
      <Card title="Identity">
        <div className="x-grid-2">
          <label style={col}><span className={label}>First name</span><input className="x-input" name="first_name" required defaultValue={values?.first_name} /></label>
          <label style={col}><span className={label}>Last name</span><input className="x-input" name="last_name" required defaultValue={values?.last_name} /></label>
          <label style={col}><span className={label}>Email</span><input className="x-input" name="email" type="email" required defaultValue={values?.email} /></label>
          {mode === "edit" && <label style={col}><span className={label}>Photo URL</span><input className="x-input" name="photo_url" type="url" defaultValue={values?.photo_url ?? ""} /></label>}
        </div>
      </Card>
      <Card title="Access">
        <div className="x-grid-2">
          <label style={col}>
            <span className={label}>Role</span>
            <select className="x-input" name="role" value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
            </select>
          </label>
          {mode === "edit" && (
            <label style={col}>
              <span className={label}>Status</span>
              <select className="x-input" name="status" defaultValue={values?.status}>
                {values?.status === "invited" && <option value="invited">Invited</option>}
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
          )}
        </div>
        {mode === "invite" && <p className="type-caption text-ink-muted" style={{ marginTop: 10 }}>Invited users receive an email to set their password. Status starts as Invited.</p>}
      </Card>
      <Card title="Organization">
        {role === "dealership" ? (
          <div style={col}>
            <span className={label}>Dealerships</span>
            <input className="x-input" placeholder="Select dealerships" aria-label="Search dealerships" value={q} onChange={(e) => setQ(e.target.value)} />
            <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid #e3e5e8", borderRadius: 8, padding: 8 }}>
              {list.map((s) => (
                <label key={s.id} style={{ display: "flex", gap: 8, padding: "4px 2px", fontSize: 14, cursor: "pointer" }}>
                  <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} />
                  {s.name}
                </label>
              ))}
            </div>
            {picked.map((id) => <input key={id} type="hidden" name="dealerships" value={id} />)}
            <p className="type-caption text-ink-muted">Required for dealership-role users. Assign every store this person should see. Team is not used for this role. {picked.length} selected{picked.length ? `: ${picked.map((id) => names.get(id)).slice(0, 5).join(", ")}${picked.length > 5 ? "…" : ""}` : ""}</p>
          </div>
        ) : (
          <label style={{ ...col, maxWidth: 360 }}>
            <span className={label}>Team</span>
            <select className="x-input" name="team_id" defaultValue={values?.team_id ?? ""}>
              <option value="">No team</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
      </Card>
      {state.error && <p role="alert" className="text-sm text-status-attention-ink">{state.error}</p>}
      {state.notice && <p role="status" className="text-sm text-ink-muted">{state.notice}</p>}
      <div className="x-filters">
        <button className="x-btn x-btn-primary" disabled={pending}>{pending ? "…" : submit}</button>
        <Link className="x-btn" href="/users" style={{ display: "inline-flex", alignItems: "center" }}>Cancel</Link>
      </div>
    </form>
  );
}

export function ResendInvite({ action }: { action: (state: FormState) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="x-filters">
      <button className="x-btn" disabled={pending}>Resend invitation</button>
      {state.error && <span role="alert" className="text-sm text-status-attention-ink">{state.error}</span>}
      {state.notice && <span role="status" className="text-sm text-ink-muted">{state.notice}</span>}
    </form>
  );
}
