"use client";
import React, { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export default function Login() {
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function passwordSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error: failed } = await supabase.auth.signInWithPassword({ email, password });
    if (failed) { setError("That email and password didn’t match."); setBusy(false); return; }
    window.location.assign("/");
  }
  async function signIn() {
    setBusy(true);
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback`, queryParams: { hd: "worldwidebdc.com", prompt: "select_account" } },
    });
    if (error) setBusy(false);
  }
  return (
    <div className="x-auth">
      <header className="x-auth-band">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="Worldwide BDC" width={172} height={28} src="/brand/logo-worldwide-light.svg" />
      </header>
      <section className="x-auth-card">
        <h1 className="x-title">Sign in</h1>
        <p className="x-subtitle" style={{ margin: "6px 0 20px" }}>@worldwidebdc.com accounts use Google.</p>
        <button className="x-btn x-btn-black" style={{ width: "100%", height: 44 }} onClick={signIn} disabled={busy}>{busy ? "…" : "Continue with Google"}</button>
        <p className="text-sm text-ink-muted" style={{ margin: "18px 0 10px" }}>Everyone else signs in with email.</p>
        <form onSubmit={passwordSignIn} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input className="x-input" type="email" required autoComplete="email" placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="x-input" type="password" required autoComplete="current-password" placeholder="Password" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p role="alert" className="text-sm text-status-attention-ink">{error}</p>}
          <button className="x-btn" disabled={busy}>Sign in</button>
          <a href="/forgot-password" className="text-sm text-accent">Forgot your password?</a>
        </form>
      </section>
    </div>
  );
}
