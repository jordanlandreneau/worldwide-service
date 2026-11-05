import { notFound } from "next/navigation";
import { Card, Page } from "@/components/ui";
import { ResendInvite, UserForm } from "@/components/user-form";
import { isServiceTeam, requireUser } from "@/lib/access";
import { db, fetchAll } from "@/lib/data";
import { resendInvite, saveUser } from "@/lib/users";

export const metadata = { title: "Edit user · Worldwide Service" };

export default async function EditUser({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const actor = await requireUser("manager");
  const { id } = await params;
  const { notice } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const client = db();
  const { data: user } = await client.from("app_users").select("*").eq("id", id).maybeSingle();
  if (!user) notFound();
  const { data: links } = await client.from("user_dealerships").select("dealership_id").eq("user_id", id);
  const [teams, stores] = await Promise.all([fetchAll<any>("teams", "id,name", "name").then((t) => t.filter((x) => isServiceTeam(x.name))), fetchAll<any>("dealerships", "id,name", "name")]);
  const roles = actor.role === "admin" || user.role === "admin" ? ["agent", "manager", "admin", "dealership"] : ["agent", "manager", "dealership"];
  return (
    <Page title={`${user.first_name} ${user.last_name}`.trim() || user.email} subtitle="Edit user">
      {notice === "not-sent" && <Card><p role="alert" className="text-sm text-status-attention-ink">This user was added, but the invitation email couldn’t be sent. Check the email settings, then resend it.</p></Card>}
      {user.status === "invited" && <Card><ResendInvite action={resendInvite.bind(null, id)} /></Card>}
      <UserForm
        mode="edit" teams={teams} stores={stores} roles={roles} submit="Save changes" action={saveUser.bind(null, id)}
        values={{ first_name: user.first_name, last_name: user.last_name, email: user.email, photo_url: user.photo_url, role: user.role, status: user.status, team_id: user.team_id, dealerships: (links ?? []).map((l) => l.dealership_id as string) }}
      />
    </Page>
  );
}
