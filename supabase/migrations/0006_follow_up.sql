-- Follow-up portal (rebuilt from Lovable's "dealer-sync"): dealership chats on WhatsApp, Teams,
-- email, Google Chat and text, the people in them, and the messages sent and received.

create table follow_chats (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null check (channel in ('whatsapp', 'teams', 'email', 'google_chat', 'sms')),
  dealership_id uuid references dealerships(id) on delete set null,
  whatsapp_group_id text,   -- Periskope chat id, e.g. 1203...@g.us
  teams_chat_id text,       -- Microsoft Graph chat id, e.g. 19:...@thread.v2
  google_chat_space text,   -- spaces/AAAA...
  linq_group_id text,       -- Linq text group
  active boolean not null default true,
  last_activity timestamptz,
  created_at timestamptz not null default now(),
  created_by text
);
create table follow_members (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references follow_chats(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  role text not null default 'member',
  created_at timestamptz not null default now()
);
create table follow_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references follow_chats(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  sender_name text,
  sender text,              -- phone, email or account of whoever sent it
  kind text not null default 'message' check (kind in ('message', 'follow_up')),
  customer_name text, customer_phone text, vehicle text, vin text, advisor text, reason text,
  status text not null default 'sent' check (status in ('queued', 'sent', 'failed', 'received')),
  error text,
  external_id text,         -- the channel's own message id
  read boolean not null default false,
  created_by text,
  created_at timestamptz not null default now()
);
create index on follow_members (chat_id);
create index on follow_messages (chat_id, created_at desc);
create index on follow_messages (created_at desc);
create unique index follow_messages_external on follow_messages (chat_id, external_id);
create index on follow_chats (dealership_id);

alter table follow_chats enable row level security;
alter table follow_members enable row level security;
alter table follow_messages enable row level security;
notify pgrst, 'reload schema';
