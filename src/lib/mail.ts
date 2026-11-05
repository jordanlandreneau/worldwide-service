import "server-only";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const escapeHtml = esc;

// Sends through Resend from INVITE_EMAIL_FROM. Returns false if it couldn't send.
export async function sendMail({ to, subject, html, replyTo }: { to: string[]; subject: string; html: string; replyTo?: string }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.INVITE_EMAIL_FROM;
  if (!key || !from || !to.length) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
