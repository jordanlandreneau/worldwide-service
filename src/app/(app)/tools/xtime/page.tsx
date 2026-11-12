import { Card, Page } from "@/components/ui";
import { Bookmarklet } from "@/components/bookmarklet";
import { requireUser } from "@/lib/access";

export const metadata = { title: "Xtime list export · Worldwide Service" };

// Pulling a whole Xtime outbound call list to a CSV in one click, instead of paging 10 customers at a time.
export default async function XtimeExport() {
  await requireUser("agent");
  return (
    <Page title="Xtime list export" subtitle="Pull a whole Xtime outbound call list to a CSV in one click.">
      <Card title="1. Add the button (once)">
        <p className="text-sm" style={{ marginBottom: 12 }}>Show your bookmarks bar (Ctrl+Shift+B, or Cmd+Shift+B on a Mac), then drag this button onto it:</p>
        <Bookmarklet src="/tools/xtime-export.js" label="⬇ Xtime list to CSV" />
      </Card>
      <Card title="2. Use it">
        <ol className="bm-steps">
          <li>In Xtime, go to <strong>Outbound → Call List</strong> and click the list you want (for example <em>Welcome to Service</em> or <em>OD Service Reminder</em>).</li>
          <li>When the customers show, click <strong>⬇ Xtime list to CSV</strong> in your bookmarks bar.</li>
          <li>A dark box in the top right counts the customers as it reads every page. When it&apos;s done, the CSV downloads, named after the list and today&apos;s date.</li>
        </ol>
        <p className="text-sm" style={{ marginTop: 10 }}><strong>Clean-up is automatic:</strong> duplicate customers are merged into one row (matched by any shared phone number, or the same full name), with all their vehicles and phone numbers together; names are put in normal case; phone numbers are formatted and bad ones removed; customers with no usable phone are left out. The box tells you how many were merged and left out.</p>
        <p className="text-sm text-ink-muted" style={{ marginTop: 10 }}>It runs only in your own Xtime tab with your own login and doesn&apos;t send anything anywhere; the file goes straight to your Downloads. The CSV has first and last name, up to three phone numbers, email, vehicle(s), call program, agent, work status, last modified and how many times the customer was on the Xtime list. You can upload it to a campaign in the Command Center&apos;s Outbound Lists.</p>
      </Card>
    </Page>
  );
}
