-- Catalog tables, service content, private files and the password reveal log.
create table teams (id uuid primary key, name text not null, status text, dealership_count int, active_dealership_count int, source_updated text);
create table sources (id uuid primary key, name text not null, status text, source_updated text);
create table vehicle_makes (id uuid primary key, name text not null, status text, source_updated text);
create table vehicle_models (id uuid primary key, name text not null, make_name text, status text, source_updated text);

-- path includes the query string, for example /service/training?section=car-parts
create table service_pages (path text primary key, title text, html text not null, tabs jsonb);

-- Written before a password is returned. If the write fails, the reveal is refused.
create table credential_reveal_log (
  id bigint generated always as identity primary key,
  credential_id uuid not null references crm_credentials(id),
  dealership_id uuid not null references dealerships(id),
  user_email text not null,
  user_role text not null,
  context text not null,
  rules_acknowledged int not null,
  revealed_at timestamptz not null default now()
);
create index on credential_reveal_log (revealed_at desc);
create index on credential_reveal_log (user_email);

alter table teams enable row level security;
alter table sources enable row level security;
alter table vehicle_makes enable row level security;
alter table vehicle_models enable row level security;
alter table service_pages enable row level security;
alter table credential_reveal_log enable row level security;

insert into storage.buckets (id, name, public) values ('service-files', 'service-files', false)
on conflict (id) do nothing;

-- The raw capture of the Dealer Sync page only held a link to the old Lovable app.
delete from raw_pages where path = '/service/dealer-sync';

notify pgrst, 'reload schema';
