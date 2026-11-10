-- A text chat's JustCall group conversation (created on the first send).
alter table follow_chats add column if not exists justcall_group_id text;
notify pgrst, 'reload schema';
