-- Agents are assigned to individual calling sheets (several agents can share one), and work through them row by row.
create table if not exists list_assignments (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references outbound_lists(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  assigned_by text, created_at timestamptz not null default now(),
  unique (list_id, user_id)
);
create index if not exists list_assignments_user on list_assignments (user_id);
insert into list_assignments (list_id, user_id, assigned_by)
  select id, assigned_to, 'moved from assigned_to' from outbound_lists where assigned_to is not null
  on conflict do nothing;

-- One outcome per customer row on a sheet. The latest outcome wins; the history stays in list_progress_log.
create table if not exists list_progress (
  list_id uuid not null references outbound_lists(id) on delete cascade,
  row_index int not null,
  status text not null,
  note text,
  user_id uuid references app_users(id) on delete set null,
  user_name text,
  updated_at timestamptz not null default now(),
  primary key (list_id, row_index)
);
create table if not exists list_progress_log (
  id bigint generated always as identity primary key,
  list_id uuid not null references outbound_lists(id) on delete cascade,
  row_index int not null, status text not null, note text,
  user_id uuid, user_name text, created_at timestamptz not null default now()
);
create index if not exists list_progress_log_list on list_progress_log (list_id, created_at desc);
alter table list_assignments enable row level security;
alter table list_progress enable row level security;
alter table list_progress_log enable row level security;
notify pgrst, 'reload schema';
