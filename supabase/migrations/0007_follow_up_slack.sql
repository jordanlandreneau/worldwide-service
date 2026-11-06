-- Slack joins the follow-up channels, as in dealer-sync.
alter table follow_chats drop constraint follow_chats_channel_check;
alter table follow_chats add constraint follow_chats_channel_check check (channel in ('whatsapp', 'teams', 'email', 'google_chat', 'sms', 'slack'));
alter table follow_chats add column if not exists slack_channel_id text;
notify pgrst, 'reload schema';
