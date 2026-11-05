"use client";
import { useState } from "react";
import { revealPassword } from "@/lib/credentials";
import type { Credential } from "@/lib/data";

function Copy({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={`svc-copy${done ? " copied" : ""}`} title={`Copy ${label}`} onClick={async () => { await navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); }}>
      {done ? "Copied" : value}
    </button>
  );
}

// Service logins as cards, like the BMW guide. Passwords stay on the server until someone reveals one.
export function ServiceLogins({ credentials }: { credentials: Credential[] }) {
  const [shown, setShown] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  async function reveal(id: string) {
    if (shown[id] !== undefined) { setShown(({ [id]: _, ...rest }) => rest); return; }
    const res = await revealPassword(id, "service", []);
    if (res.error || res.password === undefined) { setError(res.error ?? "Couldn't reveal this password."); return; }
    setError(null);
    setShown((s) => ({ ...s, [id]: res.password! }));
  }
  return (
    <>
      {error && <p role="alert" className="svc-error">{error}</p>}
      <div className="svc-logins">
        {credentials.map((c) => (
          <div key={c.id} className="svc-login">
            <h3>{c.crm_type ?? "Service login"}</h3>
            {c.login_url && <p><a href={c.login_url} target="_blank" rel="noopener noreferrer">Open login</a></p>}
            <ul>
              <li><strong>User</strong>{c.username ? <Copy value={c.username} label="username" /> : <span>—</span>}</li>
              <li>
                <strong>Pass</strong>
                {!c.has_password ? <span>—</span> : shown[c.id] !== undefined ? <Copy value={shown[c.id]} label="password" /> : <span className="svc-masked">••••••••</span>}
                {c.has_password && <button type="button" className="svc-reveal" onClick={() => reveal(c.id)}>{shown[c.id] !== undefined ? "Hide" : "Show"}</button>}
              </li>
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
