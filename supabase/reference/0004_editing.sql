-- Lets the site create records, and records who changed what. Values aren't logged.
alter table dealerships alter column id set default gen_random_uuid();
alter table contacts alter column id set default gen_random_uuid();
alter table hours alter column id set default gen_random_uuid();
alter table message_templates alter column id set default gen_random_uuid();
alter table store_rules alter column id set default gen_random_uuid();
alter table crm_credentials alter column id set default gen_random_uuid();
alter table teams alter column id set default gen_random_uuid();
alter table sources alter column id set default gen_random_uuid();
alter table vehicle_makes alter column id set default gen_random_uuid();
alter table vehicle_models alter column id set default gen_random_uuid();

create table edit_log (
  id bigint generated always as identity primary key,
  user_email text not null,
  table_name text not null,
  row_id text not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index on edit_log (created_at desc);
alter table edit_log enable row level security;

-- Keep reveal history when a login is deleted.
alter table credential_reveal_log alter column credential_id drop not null;
alter table credential_reveal_log drop constraint credential_reveal_log_credential_id_fkey;
alter table credential_reveal_log add constraint credential_reveal_log_credential_id_fkey foreign key (credential_id) references crm_credentials(id) on delete set null;

notify pgrst, 'reload schema';
