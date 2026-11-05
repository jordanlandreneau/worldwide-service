"use client";
import { useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { revealPassword } from "@/lib/credentials";
import { External, Table } from "@/components/ui";
import type { Credential } from "@/lib/data";

type Rule = { id: string; note: string };
const copy = (text: string) => navigator.clipboard?.writeText(text);

// Checkbox state lives only in this component, so it resets on reload just like 3.0.
// The server checks the same list again before returning any password.
export function CredentialsPanel({ context, rules, credentials, deptName }: {
  context: "info" | "manage";
  rules: Rule[];
  credentials: Credential[];
  deptName: Record<string, string>;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const done = rules.filter((r) => checked[r.id]).length;
  const unlocked = context === "manage" || done === rules.length;
  const lockedTitle = "Acknowledge store rules to reveal";

  async function get(id: string) {
    if (shown[id] !== undefined) return shown[id];
    const res = await revealPassword(id, context, rules.filter((r) => checked[r.id]).map((r) => r.id));
    if (res.error || res.password === undefined) { setError(res.error ?? "Couldn't reveal this password."); return null; }
    setError(null);
    return res.password;
  }
  async function toggle(id: string, visible: string | undefined) {
    if (visible !== undefined) { setShown(({ [id]: _, ...rest }) => rest); return; }
    const value = await get(id);
    if (value !== null) setShown((s) => ({ ...s, [id]: value }));
  }
  async function copyPassword(id: string) {
    const value = await get(id);
    if (value !== null) copy(value);
  }

  return (
    <>
      {context === "info" && rules.length > 0 && (
        <div className="mb-5 rounded-datum border border-status-attention-border bg-status-attention-fill p-4" role="group">
          <header className="mb-3">
            <h3 className="text-card font-semibold text-status-attention-ink">Store rules</h3>
            <p className="mt-1 type-caption text-status-attention-ink/90">
              {unlocked ? "All rules acknowledged — passwords can be revealed." : "Passwords remain locked until every rule is acknowledged."}{" "}
              <span className="font-figure">{done}/{rules.length}</span> acknowledged.
            </p>
          </header>
          <ul className="x-rules">
            {rules.map((r) => (
              <li key={r.id}>
                <label className="x-rule">
                  <input type="checkbox" checked={!!checked[r.id]} onChange={(e) => setChecked((c) => ({ ...c, [r.id]: e.target.checked }))} />
                  <span className="min-w-0 flex-1">
                    <span className="type-label text-ink-title">I have read this rule</span>
                    <p className="mt-1.5 x-prewrap text-sm font-medium leading-relaxed">{r.note}</p>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p role="alert" className="mb-3 text-sm text-status-attention-ink">{error}</p>}
      <Table
        head={["Department", "CRM", "Username", "Password", "Login"]}
        empty="No CRM logins for this store."
        rows={credentials.map((c) => {
          const visible = shown[c.id];
          return [
            c.department_id ? deptName[c.department_id] ?? "—" : "—",
            c.crm_type ?? "—",
            <span key="u" className="inline-flex items-center gap-1.5">
              <span className="x-mono">{c.username ?? "—"}</span>
              {c.username && <button className="x-icon" title="Copy username" aria-label="Copy username" onClick={() => copy(c.username!)}><Copy size={14} /></button>}
            </span>,
            c.has_password ? (
              <span key="p" className="inline-flex items-center gap-1.5">
                <span className="x-mono">{visible ?? "••••••••"}</span>
                <button className="x-icon" disabled={!unlocked} title={unlocked ? (visible !== undefined ? "Hide password" : "Reveal password") : lockedTitle} aria-label={unlocked ? "Reveal password" : lockedTitle} onClick={() => toggle(c.id, visible)}>
                  {visible !== undefined ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button className="x-icon" disabled={!unlocked} title={unlocked ? "Copy password" : lockedTitle} aria-label={unlocked ? "Copy password" : lockedTitle} onClick={() => copyPassword(c.id)}><Copy size={14} /></button>
              </span>
            ) : "—",
            c.login_url ? <a key="l" href={c.login_url} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">Open</a> : <External key="l" />,
          ];
        })}
      />
    </>
  );
}
