import type { ReactNode } from "react";
import { Shell } from "@/components/shell";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/access";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/no-access");
  return <Shell user={{ name: user.name, role: user.role }}>{children}</Shell>;
}
