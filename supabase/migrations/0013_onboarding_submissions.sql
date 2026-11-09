-- Service onboarding forms sent over from the Admin Hub. Each one creates (or fills in) a store's Service Data page.
create table if not exists onboarding_submissions (
  id uuid primary key default gen_random_uuid(),
  source_id text unique,
  dealership_id uuid references dealerships(id) on delete set null,
  dealer_name text not null,
  submitter_email text,
  result text not null default 'created', -- created | filled
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists onboarding_submissions_store on onboarding_submissions (dealership_id);
alter table onboarding_submissions enable row level security;
notify pgrst, 'reload schema';
