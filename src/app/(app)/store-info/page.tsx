import { StorePicker } from "@/components/store-picker";
import { StoreRecord } from "@/components/store-record";
import { Page } from "@/components/ui";
import { requireUser } from "@/lib/access";
import { cachedAll, fetchAll, loadDealership } from "@/lib/data";

export const metadata = { title: "Store Info · Worldwide Service" };

// Every agent can open every store.
export default async function StoreInfo({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  await requireUser();
  const { d } = await searchParams;
  const stores = (await cachedAll("dealerships", "id,name,active", "name")).filter((s) => s.active);
  // A link to an inactive store opens the first active one instead.
  const pick = stores.some((s) => s.id === d) ? d : stores[0]?.id;
  const data = pick && /^[0-9a-f-]{36}$/i.test(pick) ? await loadDealership(pick) : null;
  return (
    <Page title={data?.store.name ?? "Store Info"} subtitle="Store instructions, departments, and contact details." actions={<StorePicker base="/store-info" stores={stores} selected={data?.store.name} />}>
      {data ? <StoreRecord key={data.store.id} data={data} context="info" /> : <p className="text-sm text-ink-muted">Select a dealership.</p>}
    </Page>
  );
}
