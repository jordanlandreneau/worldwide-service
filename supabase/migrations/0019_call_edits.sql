-- Corrections managers make to JustCall calls on the Call Recordings tab (JustCall itself isn't changed).
create table if not exists call_edits (
  call_id bigint primary key,
  dealership_id uuid references dealerships(id) on delete cascade,
  connected boolean,            -- null = go by talk time
  agent text, disposition text, notes text,
  hidden boolean not null default false,
  edited_by text, updated_at timestamptz not null default now()
);
create index if not exists call_edits_store on call_edits (dealership_id);
alter table call_edits enable row level security;
notify pgrst, 'reload schema';
