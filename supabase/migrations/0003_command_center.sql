-- Store Command Center: outbound campaigns per store, grouped by category, worked in two waves.
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references dealerships(id) on delete cascade,
  category text not null,
  name text not null,
  description text,
  cadence text,
  list_ref text,
  launch_date text,
  wave1_done boolean not null default false,
  wave2_done boolean not null default false,
  script text,
  info text,
  sort_order int not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on campaigns (dealership_id, category, sort_order);

-- Analytics breakdown: what the service team made and set, entered by hand per campaign and day.
create table campaign_stats (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  dealership_id uuid not null references dealerships(id) on delete cascade,
  stat_date date not null,
  calls_made int not null default 0 check (calls_made >= 0),
  appointments_set int not null default 0 check (appointments_set >= 0),
  notes text,
  entered_by text not null,
  created_at timestamptz not null default now()
);
create index on campaign_stats (dealership_id, stat_date desc);
create index on campaign_stats (campaign_id);

-- Outbound call lists a store uploads as CSV. Rows are kept as uploaded.
create table outbound_lists (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references dealerships(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  file_name text not null,
  columns jsonb not null,
  rows jsonb not null,
  row_count int not null,
  note text,
  uploaded_by text not null,
  uploaded_at timestamptz not null default now()
);
create index on outbound_lists (dealership_id, uploaded_at desc);

alter table campaigns enable row level security;
alter table campaign_stats enable row level security;
alter table outbound_lists enable row level security;

notify pgrst, 'reload schema';
