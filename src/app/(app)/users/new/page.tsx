import { Page } from "@/components/ui";
import { UserForm } from "@/components/user-form";
import { requireUser } from "@/lib/access";
import { fetchAll } from "@/lib/data";
import { inviteUser } from "@/lib/users";

export const metadata = { title: "Create user · Worldwide Service" };

export default async function CreateUser({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const actor = await requireUser("manager");
  const { store } = await searchParams;
  const [teams, stores] = await Promise.all([fetchAll<any>("teams", "id,name", "name"), fetchAll<any>("dealerships", "id,name", "name")]);
  const roles = actor.role === "admin" ? ["agent", "manager", "admin", "dealership"] : ["agent", "manager", "dealership"];
  return (
    <Page title="Create user" subtitle="They get an email from noreply@alerts.worldwidebdc.com to set their own password. Store users only see the stores you tick.">
      <UserForm
        mode="invite" teams={teams} stores={stores} roles={roles} action={inviteUser} submit="Create user and send invite"
        values={store && stores.some((s: any) => s.id === store) ? { first_name: "", last_name: "", email: "", role: "dealership", dealerships: [store] } : undefined}
      />
    </Page>
  );
}
