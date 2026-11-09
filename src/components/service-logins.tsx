"use client";
import { useState } from "react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { revealPassword } from "@/lib/credentials";
import type { Credential } from "@/lib/data";

// Clipboard API first; falls back to a hidden text box where the browser blocks it.
async function toClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand("copy");
    box.remove();
    return ok;
  }
}

function CopyButton({ get, label }: { get: () => Promise<string | null>; label: string }) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  return (
    <button type="button" className="svc-icon-btn" title={`Copy ${label}`} aria-label={`Copy ${label}`}
      onClick={async () => {
        const value = await get();
        if (value === null) return;
        setState((await toClipboard(value)) ? "done" : "fail");
        setTimeout(() => setState("idle"), 1400);
      }}>
      {state === "done" ? <><Check size={14} aria-hidden /> Copied</> : state === "fail" ? "Select and copy" : <><Copy size={14} aria-hidden /> Copy</>}
    </button>
  );
}

// Service logins as cards, like the BMW guide. Usernames and revealed passwords are plain text
// (select and copy by hand works too) and each has a Copy button.
export function ServiceLogins({ credentials }: { credentials: Credential[] }) {
  const [shown, setShown] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  async function fetchPassword(id: string) {
    if (shown[id] !== undefined) return shown[id];
    const res = await revealPassword(id, "service", []);
    if (res.error || res.password === undefined) { setError(res.error ?? "Couldn't open this password."); return null; }
    setError(null);
    return res.password;
  }
  async function toggle(id: string) {
    if (shown[id] !== undefined) { setShown(({ [id]: _, ...rest }) => rest); return; }
    const value = await fetchPassword(id);
    if (value !== null) setShown((s) => ({ ...s, [id]: value }));
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
              <li>
                <strong>User</strong>
                <span className="svc-secret">{c.username ?? "—"}</span>
                <span className="svc-actions">{c.username && <CopyButton label="username" get={async () => c.username} />}</span>
              </li>
              <li>
                <strong>Pass</strong>
                <span className="svc-secret">{!c.has_password ? "—" : shown[c.id] ?? "••••••••"}</span>
                {c.has_password && (
                  <span className="svc-actions">
                    <button type="button" className="svc-icon-btn" onClick={() => toggle(c.id)} aria-label={shown[c.id] !== undefined ? "Hide password" : "Show password"} title={shown[c.id] !== undefined ? "Hide password" : "Show password"}>
                      {shown[c.id] !== undefined ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                    </button>
                    <CopyButton label="password" get={() => fetchPassword(c.id)} />
                  </span>
                )}
              </li>
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
