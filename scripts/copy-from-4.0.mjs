// One-time copy of Service data from Worldwide 4.0's Supabase project into the Service site's own
// project. Run it once, after applying supabase/migrations/0001_service_site.sql to the new project
// and before anyone starts editing on the Service site. After that the two databases are separate:
// edits in one never show up in the other.
//
//   SOURCE_URL=https://jqljsqogqjumcghcvbxr.supabase.co SOURCE_SERVICE_ROLE_KEY=... \
//   TARGET_URL=https://<new-project>.supabase.co TARGET_SERVICE_ROLE_KEY=... \
//   node scripts/copy-from-4.0.mjs            # add --dry-run to only count what would be copied
//
// It only reads from 4.0. Running it again overwrites matching rows in the Service site with 4.0's
// copy, so don't re-run it once the Service site is in use.
//
// What it copies:
//   - Service stores: 4.0 dealerships that have Service Data or are marked service_required
//   - service_profiles for those stores, all service_pages
//   - app_users with agent, manager or admin roles (dealership logins can't use the Service site).
//     Sign-ins themselves can't be copied: Google users just sign in again, and email + password
//     users use "Forgot password" once to set a password on the new site.
//   - Service Admin history from edit_log
//   - every file in the private service-files bucket

import { createClient } from "@supabase/supabase-js";

const dry = process.argv.includes("--dry-run");
const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing ${k}`); process.exit(1); }
  return v;
};
const opts = { auth: { persistSession: false } };
const src = createClient(need("SOURCE_URL"), need("SOURCE_SERVICE_ROLE_KEY"), opts);
const dst = createClient(need("TARGET_URL"), need("TARGET_SERVICE_ROLE_KEY"), opts);
if (need("SOURCE_URL") === need("TARGET_URL")) { console.error("Source and target are the same project."); process.exit(1); }

async function readAll(table, select, order, filter = (q) => q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(src.from(table).select(select)).order(order).range(from, from + 999);
    if (error) throw new Error(`read ${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function write(table, rows, onConflict) {
  console.log(`${table}: ${rows.length}`);
  if (dry || !rows.length) return;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = onConflict ? await dst.from(table).upsert(batch, { onConflict }) : await dst.from(table).insert(batch);
    if (error) throw new Error(`write ${table}: ${error.message}`);
  }
}

// Stores
const profiles = await readAll("service_profiles", "dealership_id,data", "dealership_id");
const withProfile = new Set(profiles.map((p) => p.dealership_id));
const allStores = await readAll("dealerships", "id,name,active,timezone,address,phone,website,logo_url,service_required", "name");
const stores = allStores
  .filter((s) => withProfile.has(s.id) || s.service_required)
  .map(({ service_required, ...s }) => ({ ...s, active: s.active ?? true }));
await write("dealerships", stores, "id");
const storeIds = new Set(stores.map((s) => s.id));
await write("service_profiles", profiles.filter((p) => storeIds.has(p.dealership_id)), "dealership_id");

// Pages
await write("service_pages", await readAll("service_pages", "path,title,html,tabs", "path"), "path");

// Users. auth_user_id is left empty: the new project has its own sign-ins, and the site links each
// person to their sign-in by email the first time they sign in.
const users = await readAll(
  "app_users",
  "id,first_name,last_name,email,photo_url,role,status,team_name,invited_at,last_sign_in_at,created_at,updated_at",
  "email",
  (q) => q.in("role", ["agent", "manager", "admin"]),
);
await write("app_users", users.map((u) => ({ ...u, auth_user_id: null, last_sign_in_at: null })), "id");

// Service Admin history. Identity ids are generated fresh, so this only runs if the log is empty.
const history = await readAll("edit_log", "user_email,table_name,row_id,action,created_at", "created_at", (q) => q.eq("table_name", "service_profiles"));
const { count } = await dst.from("edit_log").select("id", { count: "exact", head: true });
if (count) console.log(`edit_log: skipped, the Service site already has ${count} entries`);
else await write("edit_log", history.filter((h) => storeIds.has(h.row_id)), null);

// Files
const { data: bucket } = await dst.storage.getBucket("service-files");
if (!bucket && !dry) {
  const { error } = await dst.storage.createBucket("service-files", { public: false });
  if (error) throw new Error(`create bucket: ${error.message}`);
}
const files = [];
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await src.storage.from("service-files").list("", { limit: 1000, offset });
  if (error) throw new Error(`list files: ${error.message}`);
  files.push(...data.filter((f) => f.id));
  if (data.length < 1000) break;
}
console.log(`service-files: ${files.length}`);
if (!dry) {
  for (const f of files) {
    const { data, error } = await src.storage.from("service-files").download(f.name);
    if (error) throw new Error(`download ${f.name}: ${error.message}`);
    const up = await dst.storage.from("service-files").upload(f.name, data, { upsert: true, contentType: data.type || f.metadata?.mimetype });
    if (up.error) throw new Error(`upload ${f.name}: ${up.error.message}`);
  }
}

console.log(dry ? "Dry run, nothing written." : "Done.");
