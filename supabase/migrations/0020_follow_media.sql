-- Pictures and PDFs on Follow-ups messages, kept in a private storage bucket.
alter table follow_messages add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table follow_messages add column if not exists mentions jsonb not null default '[]'::jsonb;
insert into storage.buckets (id, name, public, file_size_limit) values ('follow-media', 'follow-media', false, 10485760) on conflict (id) do nothing;
notify pgrst, 'reload schema';
