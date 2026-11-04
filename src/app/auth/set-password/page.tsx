"use client";
import React, { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export default function SetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 10) return setError("Use at least 10 characters.");
    if (password !== confirm) return setError("The passwords don’t match.");
    setBusy(true);
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error: failed } = await supabase.auth.updateUser({ password });
    if (failed) { setError("Couldn’t save that password. Try a different one."); setBusy(false); return; }
    window.location.assign("/");
  }
  return (
    <div className="x-auth x-auth-plain">
      <section className="x-auth-card">
        <h1 className="x-title" style={{ marginBottom: 14 }}>Set your password</h1>
        <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input className="x-input" type="password" autoComplete="new-password" placeholder="New password" aria-label="New password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <input className="x-input" type="password" autoComplete="new-password" placeholder="Confirm password" aria-label="Confirm password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {error && <p role="alert" className="text-sm text-status-attention-ink">{error}</p>}
          <button className="x-btn x-btn-primary" disabled={busy}>Save password</button>
        </form>
      </section>
    </div>
  );
}
