-- Deadlines on campaign tasks and calling sheets, agents/teams assigned to stores, and site events for popups.
alter table campaigns add column if not exists due_at timestamptz;
alter table outbound_lists add column if not exists due_at timestamptz;

create table if not exists store_assignments (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references dealerships(id) on delete cascade,
  user_id uuid references app_users(id) on delete cascade,
  team_id uuid references teams(id) on delete cascade,
  created_by text, created_at timestamptz not null default now(),
  check ((user_id is null) <> (team_id is null))
);
create unique index if not exists store_assignments_user on store_assignments (dealership_id, user_id) where user_id is not null;
create unique index if not exists store_assignments_team on store_assignments (dealership_id, team_id) where team_id is not null;
create index if not exists store_assignments_store on store_assignments (dealership_id);

-- Things worth a popup for the people on a store (e.g. a store uploaded a calling sheet).
create table if not exists site_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  dealership_id uuid references dealerships(id) on delete cascade,
  title text not null, body text, link text,
  created_by text, created_at timestamptz not null default now()
);
create index if not exists site_events_created on site_events (created_at desc);

alter table store_assignments enable row level security;
alter table site_events enable row level security;
notify pgrst, 'reload schema';
