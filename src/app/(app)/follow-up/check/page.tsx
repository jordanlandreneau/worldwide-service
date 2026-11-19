import Link from "next/link";
import { Card, Page, Table } from "@/components/ui";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/data";
import { checkConnections, teamsChatCheck } from "@/lib/follow-providers";

export const metadata = { title: "Check connections · Worldwide Service" };
export const dynamic = "force-dynamic";

// Managers can confirm every Follow-ups channel answers. Only read-only calls; nothing is sent.
export default async function CheckConnections() {
  await requireUser("manager");
  const { data } = await db().from("follow_chats").select("name,channel,whatsapp_group_id,teams_chat_id,google_chat_space,last_activity").eq("active", true).order("last_activity", { ascending: false, nullsFirst: false });
  const rows = (data ?? []) as any[];
  const pick = (k: string) => rows.find((r) => r[k])?.[k] ?? null;
  const [checks, teamsChats] = await Promise.all([
    checkConnections({ whatsapp: pick("whatsapp_group_id"), teams: pick("teams_chat_id"), space: pick("google_chat_space") }),
    teamsChatCheck(rows.filter((r) => r.channel === "teams" && r.teams_chat_id)).catch(() => []),
  ]);
  teamsChats.sort((a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name));
  return (
    <Page title="Check connections" subtitle="Each channel is asked to read something small. Nothing is sent to any store." actions={<Link className="x-btn" href="/follow-up" style={{ display: "inline-flex", alignItems: "center" }}>Back to Follow-ups</Link>}>
      <Card>
        <Table head={["Channel", "Result", "Details"]} rows={checks.map((c) => [c.channel, c.ok ? "✅ Working" : "❌ Needs attention", c.detail])} />
      </Card>
      {teamsChats.length > 0 && (
        <Card title="Each Teams chat">
          <p className="text-sm text-ink-muted" style={{ marginBottom: 8 }}>A chat marked ❌ can&apos;t be read or sent to: our Teams account was removed from it, or the store started a new chat. Add our account back in Teams, or paste the new chat&apos;s id in that chat&apos;s Settings.</p>
          <Table head={["Chat", "Result", "Details"]} rows={teamsChats.map((c) => [c.name, c.ok ? "✅ Working" : "❌ Needs attention", c.detail])} />
        </Card>
      )}
    </Page>
  );
}
