-- Text chats go through JustCall from the dealership's number. A chat can name a different JustCall line.
alter table follow_chats add column if not exists justcall_line text;
notify pgrst, 'reload schema';
