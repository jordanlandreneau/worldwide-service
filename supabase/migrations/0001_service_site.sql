-- Worldwide Service: its own Supabase project, separate from Worldwide 4.0.
-- Only the tables the Service site uses. Row level security is on with no policies, so only the
-- service role (the server, through db() in src/lib/data.ts) can read or write.

-- Service stores. A slim copy of 4.0's dealerships: no CRM, JustCall or sales fields.
create table dealerships (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  timezone text,
  address text,
  phone text,
  website text,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on dealerships (name);

-- Each store's Service Data (scheduling, transportation, pricing, contacts, hours...), kept whole.
create table service_profiles (
  dealership_id uuid primary key references dealerships(id) on delete cascade,
  data jsonb not null
);

-- Guidelines, Information, Training, Reference Library and Resource Center pages.
-- path includes the query string, for example /service/training?section=car-parts
create table service_pages (path text primary key, title text, html text not null, tabs jsonb);

-- Who can sign in and their role. @worldwidebdc.com emails not listed here fall back to the HR hub.
create table app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  first_name text not null,
  last_name text not null,
  email text not null,
  photo_url text,
  role text not null check (role in ('agent', 'manager', 'admin')),
  status text not null check (status in ('invited', 'active', 'disabled')),
  team_name text,
  invited_at timestamptz,
  last_sign_in_at timestamptz,
  recovery_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index app_users_email_key on app_users (lower(email));

-- Who changed what in Service Admin. Values aren't logged.
create table edit_log (
  id bigint generated always as identity primary key,
  user_email text not null,
  table_name text not null,
  row_id text not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index on edit_log (created_at desc);

alter table dealerships enable row level security;
alter table service_profiles enable row level security;
alter table service_pages enable row level security;
alter table app_users enable row level security;
alter table edit_log enable row level security;

-- Files embedded in the Service pages. Private: served only to signed-in staff by /service-files/[name].
insert into storage.buckets (id, name, public) values ('service-files', 'service-files', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
