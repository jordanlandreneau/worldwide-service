import { notFound } from "next/navigation";
import { ServiceHtml } from "@/components/service-html";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/data";

const SLUGS = new Set(["guidelines", "information", "training", "glossary", "external-links"]);

export default async function ServicePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string>> }) {
  await requireUser();
  const { slug } = await params;
  if (!SLUGS.has(slug)) notFound();
  const { section, resource } = await searchParams;
  const base = `/service/${slug}`;
  const query = section ? `?section=${section}` : resource ? `?resource=${resource}` : "";
  const client = db();
  let { data } = await client.from("service_pages").select("html,tabs").eq("path", `${base}${query}`).maybeSingle();
  if (!data && query) notFound();
  if (!data) ({ data } = await client.from("service_pages").select("html,tabs").eq("path", base).maybeSingle());
  if (!data) notFound();
  return <ServiceHtml key={`${base}${query}`} html={data.html as string} tabs={data.tabs as { label: string; html: string }[] | null} />;
}
