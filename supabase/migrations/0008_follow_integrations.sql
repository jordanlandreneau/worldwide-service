-- Saved connection state for Follow-ups providers (the Teams sign-in, encrypted; last Teams sync).
create table if not exists follow_integrations (name text primary key, data jsonb not null default '{}', updated_at timestamptz not null default now());
alter table follow_integrations enable row level security;
notify pgrst, 'reload schema';
