import Link from "next/link";
import { Pager, query } from "@/components/report-bits";
import { Card, Page, Status, Table } from "@/components/ui";
import { requireUser } from "@/lib/access";
import { fetchAll } from "@/lib/data";

export const metadata = { title: "Users · Worldwide Service" };

const title = (s: string) => s[0].toUpperCase() + s.slice(1);
const when = (v: string | null) => (v ? new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) : "—");
const SIZE = 100;
type Search = { q?: string; role?: string; status?: string; team?: string; sort?: string; page?: string };

export default async function Users({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser("manager");
  const params = await searchParams;
  const { q = "", role = "", status = "", team = "", sort = "name" } = params;
  const page = Math.max(1, Number(params.page) || 1);
  const [users, links, teams] = await Promise.all([
    fetchAll<any>("app_users", "id,first_name,last_name,email,role,status,team_id,team_name,last_sign_in_at,updated_at", "last_name"),
    fetchAll<any>("user_dealerships", "user_id", "user_id"),
    fetchAll<any>("teams", "id,name", "name"),
  ]);
  const stores = new Map<string, number>();
  for (const l of links) stores.set(l.user_id, (stores.get(l.user_id) ?? 0) + 1);
  const term = q.trim().toLowerCase();
  const name = (u: any) => `${u.first_name} ${u.last_name}`.trim();
  const shown = users
    .filter((u) => !term || `${name(u)} ${u.email}`.toLowerCase().includes(term))
    .filter((u) => !role || u.role === role)
    .filter((u) => !status || u.status === status)
    .filter((u) => !team || u.team_id === team)
    .sort((a, b) => (sort === "email" ? a.email.localeCompare(b.email) : sort === "signin" ? String(b.last_sign_in_at ?? "").localeCompare(String(a.last_sign_in_at ?? "")) : sort === "updated" ? String(b.updated_at).localeCompare(String(a.updated_at)) : name(a).localeCompare(name(b))));
  return (
    <Page title="Users" subtitle={`${shown.length} shown · ${users.length} total`} actions={<Link href="/users/new" className="x-btn x-btn-primary" style={{ display: "inline-flex", alignItems: "center" }}>Invite user</Link>}>
      <Card>
        <form className="x-filters">
          <input className="x-input" name="q" defaultValue={q} placeholder="Name or email" aria-label="Search" />
          <select className="x-input" name="role" defaultValue={role} aria-label="Role"><option value="">All roles</option>{["agent", "manager", "admin", "dealership"].map((r) => <option key={r} value={r}>{title(r)}</option>)}</select>
          <select className="x-input" name="status" defaultValue={status} aria-label="Status"><option value="">All statuses</option>{["active", "invited", "disabled"].map((s) => <option key={s} value={s}>{title(s)}</option>)}</select>
          <select className="x-input" name="team" defaultValue={team} aria-label="Team"><option value="">All teams</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <select className="x-input" name="sort" defaultValue={sort} aria-label="Sort"><option value="name">Name</option><option value="email">Email</option><option value="signin">Last sign-in</option><option value="updated">Updated</option></select>
          <button className="x-btn x-btn-primary">Search</button>
        </form>
      </Card>
      <Card>
        <Table
          head={["User", "Email", "Role", "Status", "Team", "Dealerships", "Last sign-in", "Updated"]}
          rows={shown.slice((page - 1) * SIZE, page * SIZE).map((u) => [
            <Link key="n" href={`/users/${u.id}/edit`} className="text-accent underline-offset-2 hover:underline">{name(u) || u.email}</Link>,
            u.email, title(u.role), <Status key="s" value={title(u.status)} />, u.team_name ?? "—", stores.get(u.id) ?? 0, when(u.last_sign_in_at), when(u.updated_at),
          ])}
        />
        <Pager page={page} pages={Math.ceil(shown.length / SIZE)} href={(n) => `/users?${query(params, { page: String(n) })}`} />
      </Card>
    </Page>
  );
}
