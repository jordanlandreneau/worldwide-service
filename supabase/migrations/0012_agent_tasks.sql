-- Work handed to one agent with a deadline: a campaign task, a calling sheet, or a store assignment.
alter table campaigns add column if not exists assigned_to uuid references app_users(id) on delete set null;
alter table outbound_lists add column if not exists assigned_to uuid references app_users(id) on delete set null;
alter table store_assignments add column if not exists due_at timestamptz;
alter table store_assignments add column if not exists note text;
-- A popup meant for one person only (e.g. "you were assigned this list").
alter table site_events add column if not exists user_id uuid references app_users(id) on delete cascade;
create index if not exists campaigns_assigned on campaigns (assigned_to) where assigned_to is not null;
create index if not exists outbound_lists_assigned on outbound_lists (assigned_to) where assigned_to is not null;
notify pgrst, 'reload schema';
