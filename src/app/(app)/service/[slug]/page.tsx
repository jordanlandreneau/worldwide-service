import { notFound } from "next/navigation";
import { ReferenceImport } from "@/components/reference-import";
import { ReferenceLibrary, type Term } from "@/components/reference-library";
import { ServiceHtml } from "@/components/service-html";
import { Page } from "@/components/ui";
import { atLeast, requireUser } from "@/lib/access";
import { db, fetchAll } from "@/lib/data";

// Only the Reference Library is kept from the pages captured from 3.0.
const SLUGS = new Set(["glossary"]);
export const metadata = { title: "Reference Library · Worldwide Service" };

export default async function ServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  const { slug } = await params;
  if (!SLUGS.has(slug)) notFound();
  const terms = await fetchAll<Term>("reference_terms", "id,kind,term,meaning", "term");
  const head = { title: "Reference Library", subtitle: "Searchable automotive glossary and Spanish ↔ English dictionary" };
  if (terms.length) {
    return (
      <Page {...head}>
        <section className="x-card"><ReferenceLibrary terms={terms} canEdit={atLeast(user.role, "manager")} /></section>
      </Page>
    );
  }
  // Until it's made editable, show the page as captured from 4.0.
  const { data } = await db().from("service_pages").select("html,tabs").eq("path", `/service/${slug}`).maybeSingle();
  if (!data) notFound();
  const tabs = data.tabs as { label: string; html: string }[] | null;
  return (
    <Page {...head}>
      {user.role === "admin" && <section className="x-card"><ReferenceImport html={tabs?.[0]?.html ?? (data.html as string)} /></section>}
      <section className="x-card svc-captured">
        <ServiceHtml html={data.html as string} tabs={tabs} />
      </section>
    </Page>
  );
}
