-- Worldwide 4.0: backup of Worldwide 3.0 dealership and reference data.
-- Row level security is on with no policies, so only the service role can read
-- or write. Add policies when the app and its sign-in are built.

create table departments (
  id uuid primary key,
  name text not null,
  slug text,
  active boolean
);

create table dealerships (
  id uuid primary key,
  name text not null,
  active boolean,
  status text,
  team_id uuid,
  team_name text,
  source text,
  timezone text,
  address text,
  website text,
  phone text,
  logo_url text,
  sales_required boolean,
  service_required boolean,
  data_mining_required boolean,
  just_call_number text,
  just_call_campaign_number text,
  just_call_voicemail_id text,
  sales_dial_number text,
  sales_text_number text,
  agent_code_number text,
  assign_to_name text,
  vip_manager_1_name text,
  vip_manager_2_name text,
  crm_instructions text,
  special_note text,
  pronunciation_url text,
  auth_url text,
  source_updated_at timestamptz
);

create table dealership_departments (
  dealership_id uuid not null references dealerships(id) on delete cascade,
  department_id uuid not null references departments(id),
  active boolean,
  goal numeric,
  transfer_number text,
  just_call_number text,
  primary key (dealership_id, department_id)
);

create table contacts (
  id uuid primary key,
  dealership_id uuid not null references dealerships(id) on delete cascade,
  department_id uuid references departments(id),
  name text,
  phone text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz
);

create table hours (
  id uuid primary key,
  dealership_id uuid not null references dealerships(id) on delete cascade,
  department_id uuid references departments(id),
  day_of_week smallint not null,
  closed boolean,
  open_time text,
  close_time text,
  created_at timestamptz,
  updated_at timestamptz
);

create table message_templates (
  id uuid primary key,
  dealership_id uuid not null references dealerships(id) on delete cascade,
  department_id uuid references departments(id),
  channel text,
  purpose text,
  body text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz
);

create table store_rules (
  id uuid primary key,
  dealership_id uuid not null references dealerships(id) on delete cascade,
  note text,
  created_at timestamptz,
  updated_at timestamptz
);

-- Passwords are not loaded yet. password_ciphertext stays empty until encrypted
-- storage is set up, and plain text passwords never go in this table.
create table crm_credentials (
  id uuid primary key,
  dealership_id uuid not null references dealerships(id) on delete cascade,
  department_id uuid references departments(id),
  crm_type text,
  username text,
  login_url text,
  has_password boolean,
  password_ciphertext bytea,
  created_at timestamptz,
  updated_at timestamptz
);

-- Full Service Data record per store, kept whole until the app needs it split up.
create table service_profiles (
  dealership_id uuid primary key references dealerships(id) on delete cascade,
  data jsonb not null
);

-- Raw page data for teams, sources, vehicles, campaigns and service content.
create table raw_pages (
  path text primary key,
  content text not null,
  captured_at timestamptz
);

create index on contacts (dealership_id);
create index on hours (dealership_id);
create index on message_templates (dealership_id);
create index on store_rules (dealership_id);
create index on crm_credentials (dealership_id);
create index on dealerships (team_id);

alter table departments enable row level security;
alter table dealerships enable row level security;
alter table dealership_departments enable row level security;
alter table contacts enable row level security;
alter table hours enable row level security;
alter table message_templates enable row level security;
alter table store_rules enable row level security;
alter table crm_credentials enable row level security;
alter table service_profiles enable row level security;
alter table raw_pages enable row level security;

notify pgrst, 'reload schema';
