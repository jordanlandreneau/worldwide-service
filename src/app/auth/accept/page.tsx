import { acceptLink } from "@/lib/users";

export default async function Accept({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string; expired?: string }> }) {
  const { token_hash, type, expired } = await searchParams;
  return (
    <div className="x-auth x-auth-plain">
      <section className="x-auth-card">
        <h1 className="x-title">{expired || !token_hash ? "This link has expired" : "Set your password"}</h1>
        {expired || !token_hash ? (
          <p className="text-sm text-ink-muted">Ask your Worldwide contact to resend your invitation, or use “Forgot your password?” on the sign-in page.</p>
        ) : (
          <form action={acceptLink} style={{ marginTop: 16 }}>
            <input type="hidden" name="token_hash" value={token_hash} />
            <input type="hidden" name="type" value={type ?? "invite"} />
            <button className="x-btn x-btn-primary" style={{ width: "100%", height: 44 }}>Continue</button>
          </form>
        )}
      </section>
    </div>
  );
}
