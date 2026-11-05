import { Page } from "@/components/ui";
import { UserForm } from "@/components/user-form";
import { requireUser } from "@/lib/access";
import { fetchAll } from "@/lib/data";
import { inviteUser } from "@/lib/users";

export const metadata = { title: "Invite user · Worldwide Service" };

export default async function InviteUser() {
  const actor = await requireUser("manager");
  const [teams, stores] = await Promise.all([fetchAll<any>("teams", "id,name", "name"), fetchAll<any>("dealerships", "id,name", "name")]);
  const roles = actor.role === "admin" ? ["agent", "manager", "admin", "dealership"] : ["agent", "manager", "dealership"];
  return (
    <Page title="Invite user" subtitle="Send an invitation email. Do not set a password for them.">
      <UserForm mode="invite" teams={teams} stores={stores} roles={roles} action={inviteUser} submit="Send invitation" />
    </Page>
  );
}
