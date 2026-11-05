import { InlineForm } from "@/components/action-form";
import { StoreFields } from "@/components/store-form";
import { Card, Page } from "@/components/ui";
import { requireUser } from "@/lib/access";
import { saveStore } from "@/lib/stores";

export const metadata = { title: "New store · Worldwide Service" };

export default async function NewStore() {
  await requireUser("admin");
  return (
    <Page title="New Service store" subtitle="Add the store and its JustCall numbers. Next you can add its Service login, hours and Service Data.">
      <Card>
        <InlineForm action={saveStore.bind(null, null)} submit="Add store">
          <StoreFields />
        </InlineForm>
      </Card>
    </Page>
  );
}
