-- Change requests: anyone signed in asks for a change to the site; Lauren and Leanet are emailed.
create table change_requests (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid references dealerships(id) on delete set null,
  category text not null,
  details text not null,
  requested_by text not null,
  requester_name text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'declined')),
  handled_by text,
  emailed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on change_requests (created_at desc);
create index on change_requests (requested_by);
alter table change_requests enable row level security;
notify pgrst, 'reload schema';
