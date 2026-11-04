"use client";
import { useActionState } from "react";
import { requestReset } from "@/lib/users";

export default function ForgotPassword() {
  const [state, action, pending] = useActionState(requestReset, {});
  return (
    <div className="x-auth x-auth-plain">
      <section className="x-auth-card">
        <h1 className="x-title" style={{ marginBottom: 14 }}>Reset your password</h1>
        <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input className="x-input" type="email" name="email" required placeholder="Email" aria-label="Email" />
          {state.notice && <p role="status" className="text-sm text-ink-muted">{state.notice}</p>}
          <button className="x-btn x-btn-primary" disabled={pending}>Send reset link</button>
          <a href="/login" className="text-sm text-accent">Back to sign in</a>
        </form>
      </section>
    </div>
  );
}
