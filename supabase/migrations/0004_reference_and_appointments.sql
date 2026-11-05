-- Reference Library terms, editable on the site. Dictionary rows: term = Spanish, meaning = English.
create table reference_terms (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('glossary', 'dictionary')),
  term text not null,
  meaning text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on reference_terms (kind, lower(term));

-- Service appointments set by the team. No texts are sent: the store's CRM confirms them.
create table appointments (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references dealerships(id) on delete cascade,
  customer_name text not null,
  phone text not null,
  appt_at timestamptz not null,
  campaign_id uuid references campaigns(id) on delete set null,
  notes text,
  status text not null default 'set' check (status in ('set', 'showed', 'no_show', 'cancelled', 'rescheduled')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on appointments (dealership_id, appt_at desc);
create index on appointments (appt_at desc);

alter table reference_terms enable row level security;
alter table appointments enable row level security;

notify pgrst, 'reload schema';
