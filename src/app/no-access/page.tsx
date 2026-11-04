import { getUser } from "@/lib/access";

export default async function NoAccess() {
  const user = await getUser();
  return (
    <div className="x-auth x-auth-plain">
      <section className="x-auth-card">
        <h1 className="x-title">{user?.role === "dealership" ? "Your dealership pages aren’t available yet" : "You don’t have access to this page"}</h1>
        <p className="text-sm text-ink-muted mb-4">{user?.role === "dealership" ? "Your account is ready. We’ll let you know when your pages open." : "Your account isn’t active on this site. Ask a manager if this looks wrong."}</p>
        <form action="/auth/signout" method="post"><button className="x-btn">Sign out</button></form>
      </section>
    </div>
  );
}
