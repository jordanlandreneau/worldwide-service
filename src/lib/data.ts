import "server-only";
import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

// Service role client. RLS has no policies, so every page must call requireUser first.
export const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
    global: { fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }) },
  });

// PostgREST caps responses at 1,000 rows, so read larger tables page by page.
export async function fetchAll<T>(table: string, select: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from(table).select(select).order(order).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

export type Dealership = Record<string, any> & { id: string; name: string };
export type Credential = { id: string; department_id: string | null; crm_type: string | null; username: string | null; login_url: string | null; has_password: boolean | null };
export const CREDENTIAL_COLUMNS = "id,department_id,crm_type,username,login_url,has_password";

export async function loadDealership(id: string) {
  const client = db();
  const [store, departments, links, contacts, hours, rules, credentials, templates] = await Promise.all([
    client.from("dealerships").select("*").eq("id", id).maybeSingle(),
    client.from("departments").select("*").order("name"),
    client.from("dealership_departments").select("*").eq("dealership_id", id),
    client.from("contacts").select("*").eq("dealership_id", id).order("name"),
    client.from("hours").select("*").eq("dealership_id", id).order("day_of_week"),
    client.from("store_rules").select("id,note").eq("dealership_id", id).order("created_at"),
    // password_ciphertext is deliberately left out so it can't reach a page.
    client.from("crm_credentials").select(CREDENTIAL_COLUMNS).eq("dealership_id", id),
    client.from("message_templates").select("*").eq("dealership_id", id),
  ]);
  if (!store.data) return null;
  const deptName = new Map<string, string>((departments.data ?? []).map((d: any) => [d.id as string, d.name as string] as [string, string]));
  return {
    store: store.data as Dealership,
    deptName,
    links: (links.data ?? []) as any[],
    contacts: (contacts.data ?? []) as any[],
    hours: (hours.data ?? []) as any[],
    rules: (rules.data ?? []) as { id: string; note: string }[],
    credentials: (credentials.data ?? []) as Credential[],
    templates: (templates.data ?? []) as any[],
  };
}

// For short lists many pages read, like store names. They can lag an edit by up to a minute.
export const cachedAll = unstable_cache(
  async (table: string, select: string, order: string) => fetchAll<any>(table, select, order),
  ["lookup-v1"],
  { revalidate: 60 },
);
