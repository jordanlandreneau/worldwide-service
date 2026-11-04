-- Users page: the same roles, statuses, teams and store links as 3.0.
create table app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  first_name text not null,
  last_name text not null,
  email text not null,
  photo_url text,
  role text not null check (role in ('agent', 'manager', 'admin', 'dealership')),
  status text not null check (status in ('invited', 'active', 'disabled')),
  team_id uuid references teams(id),
  team_name text,
  invited_at timestamptz,
  last_sign_in_at timestamptz,
  recovery_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index app_users_email_key on app_users (lower(email));
create index on app_users (role);
create index on app_users (status);

create table user_dealerships (
  user_id uuid not null references app_users(id) on delete cascade,
  dealership_id uuid not null references dealerships(id) on delete cascade,
  primary key (user_id, dealership_id)
);
create index on user_dealerships (dealership_id);

alter table app_users enable row level security;
alter table user_dealerships enable row level security;

notify pgrst, 'reload schema';
