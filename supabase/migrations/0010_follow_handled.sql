-- Follow-ups: which store messages the BDC answered or acknowledged, replies linked to the message they answer,
-- and when each message reached the site (for new-message popups).
alter table follow_messages
  add column if not exists reply_to uuid references follow_messages(id) on delete set null,
  add column if not exists handled_kind text check (handled_kind in ('answered', 'acknowledged')),
  add column if not exists handled_by text,
  add column if not exists handled_name text,
  add column if not exists handled_at timestamptz,
  add column if not exists received_at timestamptz not null default now();
create index if not exists follow_messages_received on follow_messages (received_at desc) where direction = 'inbound';
create index if not exists follow_messages_reply_to on follow_messages (reply_to) where reply_to is not null;
notify pgrst, 'reload schema';
