-- Store info, CRM logins, dealership users and verification codes, carried over from Worldwide 4.0
-- for the Service stores only. Same columns as 4.0 so the copied rows fit as they are.

alter table dealerships
  add column status text, add column team_id uuid, add column team_name text, add column source text,
  add column sales_required boolean, add column service_required boolean, add column data_mining_required boolean,
  add column just_call_number text, add column just_call_campaign_number text, add column just_call_voicemail_id text,
  add column sales_dial_number text, add column sales_text_number text, add column agent_code_number text,
  add column assign_to_name text, add column vip_manager_1_name text, add column vip_manager_2_name text,
  add column crm_instructions text, add column special_note text, add column pronunciation_url text,
  add column auth_url text, add column source_updated_at timestamptz;

create table teams (id uuid primary key default gen_random_uuid(), name text not null, status text, dealership_count int, active_dealership_count int, source_updated text);
create table departments (id uuid primary key, name text not null, slug text, active boolean);

create table dealership_departments (
  dealership_id uuid not null references dealerships(id) on delete cascade,
  department_id uuid not null references departments(id),
  active boolean, goal numeric, transfer_number text, just_call_number text,
  primary key (dealership_id, department_id)
);
create table contacts (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references dealerships(id) on delete cascade,
  department_id uuid references departments(id),
  name text, phone text, active boolean, created_at timestamptz, updated_at timestamptz
);
create table hours (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references dealerships(id) on delete cascade,
  department_id uuid references departments(id),
  day_of_week smallint not null, closed boolean, open_time text, close_time text,
  created_at timestamptz, updated_at timestamptz
);
create table message_templates (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references dealerships(id) on delete cascade,
  department_id uuid references departments(id),
  channel text, purpose text, body text, active boolean, created_at timestamptz, updated_at timestamptz
);
create table store_rules (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references dealerships(id) on delete cascade,
  note text, created_at timestamptz, updated_at timestamptz
);
-- Passwords stay encrypted exactly as in 4.0. They open with the same CRM_PRIVATE_KEY.
create table crm_credentials (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references dealerships(id) on delete cascade,
  department_id uuid references departments(id),
  crm_type text, username text, login_url text, has_password boolean, password_ciphertext bytea,
  created_at timestamptz, updated_at timestamptz
);
create table credential_reveal_log (
  id bigint generated always as identity primary key,
  credential_id uuid references crm_credentials(id) on delete set null,
  dealership_id uuid not null references dealerships(id),
  user_email text not null, user_role text not null, context text not null,
  rules_acknowledged int not null, revealed_at timestamptz not null default now()
);

-- Dealership logins: store staff sign in with their own email and see only their stores.
alter table app_users drop constraint app_users_role_check;
alter table app_users add constraint app_users_role_check check (role in ('agent', 'manager', 'admin', 'dealership'));
alter table app_users add column team_id uuid references teams(id);
create table user_dealerships (
  user_id uuid not null references app_users(id) on delete cascade,
  dealership_id uuid not null references dealerships(id) on delete cascade,
  primary key (user_id, dealership_id)
);

-- CRM verification codes read from JustCall, kept 24 hours.
create table verification_codes (
  justcall_sms_id bigint primary key, code text not null, body text not null,
  contact_number text, contact_name text, justcall_number text, line_name text,
  dealership_id uuid references dealerships(id) on delete set null,
  sms_at timestamptz not null, created_at timestamptz not null default now()
);
create table justcall_sync (name text primary key, last_sms_id bigint, synced_at timestamptz);

create index on contacts (dealership_id);
create index on hours (dealership_id);
create index on message_templates (dealership_id);
create index on store_rules (dealership_id);
create index on crm_credentials (dealership_id);
create index on user_dealerships (dealership_id);
create index on verification_codes (sms_at desc);
create index on verification_codes (dealership_id, sms_at desc);
create index on credential_reveal_log (revealed_at desc);

alter table teams enable row level security;
alter table departments enable row level security;
alter table dealership_departments enable row level security;
alter table contacts enable row level security;
alter table hours enable row level security;
alter table message_templates enable row level security;
alter table store_rules enable row level security;
alter table crm_credentials enable row level security;
alter table credential_reveal_log enable row level security;
alter table user_dealerships enable row level security;
alter table verification_codes enable row level security;
alter table justcall_sync enable row level security;

notify pgrst, 'reload schema';
