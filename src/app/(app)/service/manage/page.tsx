import { redirect } from "next/navigation";
import { requireUser } from "@/lib/access";

// Service Admin moved into each store's page under Stores.
export default async function ServiceManage({ searchParams }: { searchParams: Promise<{ d?: string; tab?: string }> }) {
  await requireUser("admin");
  const { d, tab } = await searchParams;
  if (d && /^[0-9a-f-]{36}$/i.test(d)) redirect(`/stores/${d}?tab=${tab && tab !== "overview" ? tab : "general"}`);
  redirect("/stores");
}
