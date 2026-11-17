-- "No reply needed", our team's own chat-app messages, dealership colors, personal popup settings.
alter table follow_messages drop constraint if exists follow_messages_handled_kind_check;
alter table follow_messages add constraint follow_messages_handled_kind_check check (handled_kind in ('answered', 'acknowledged', 'void'));
alter table follow_messages drop constraint if exists follow_messages_kind_check;
alter table follow_messages add constraint follow_messages_kind_check check (kind in ('message', 'follow_up', 'team'));
alter table follow_chats add column if not exists color text;
alter table app_users add column if not exists follow_alerts text check (follow_alerts in ('mine', 'unclaimed', 'all'));
create index if not exists follow_messages_open on follow_messages (created_at desc) where direction = 'inbound' and handled_kind is null;
create index if not exists follow_messages_by_sender on follow_messages (chat_id, created_at desc) where direction = 'outbound' and created_by is not null;
notify pgrst, 'reload schema';
