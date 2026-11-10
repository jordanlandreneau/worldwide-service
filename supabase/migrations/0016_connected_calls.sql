-- Calls that reached the customer, so analytics can show a connection rate.
alter table campaign_stats add column if not exists calls_connected int not null default 0 check (calls_connected >= 0);
notify pgrst, 'reload schema';
