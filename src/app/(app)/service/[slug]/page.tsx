import { notFound } from "next/navigation";
import { ServiceHtml } from "@/components/service-html";
import { Page } from "@/components/ui";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/data";

// Only the Reference Library is kept from the pages captured from 3.0.
const SLUGS = new Set(["glossary"]);
export const metadata = { title: "Reference Library · Worldwide Service" };

export default async function ServicePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string>> }) {
  await requireUser();
  const { slug } = await params;
  if (!SLUGS.has(slug)) notFound();
  const { section, resource } = await searchParams;
  const base = `/service/${slug}`;
  const query = section ? `?section=${section}` : resource ? `?resource=${resource}` : "";
  const client = db();
  let { data } = await client.from("service_pages").select("title,html,tabs").eq("path", `${base}${query}`).maybeSingle();
  if (!data && query) notFound();
  if (!data) ({ data } = await client.from("service_pages").select("title,html,tabs").eq("path", base).maybeSingle());
  if (!data) notFound();
  return (
    <Page title="Reference Library" subtitle="Searchable automotive glossary and Spanish ↔ English dictionary">
      <section className="x-card svc-captured">
        <ServiceHtml key={`${base}${query}`} html={data.html as string} tabs={data.tabs as { label: string; html: string }[] | null} />
      </section>
    </Page>
  );
}
