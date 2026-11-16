-- Totals edited straight on Progress Analytics are saved as one "adjustment" entry holding the
-- difference (it can be negative), and may cover all campaigns (no campaign).
alter table campaign_stats alter column campaign_id drop not null;
alter table campaign_stats add column if not exists adjustment boolean not null default false;
alter table campaign_stats drop constraint if exists campaign_stats_calls_made_check;
alter table campaign_stats drop constraint if exists campaign_stats_appointments_set_check;
alter table campaign_stats drop constraint if exists campaign_stats_calls_connected_check;
alter table campaign_stats drop constraint if exists campaign_stats_counts_check;
alter table campaign_stats add constraint campaign_stats_counts_check check (adjustment or (calls_made >= 0 and appointments_set >= 0 and calls_connected >= 0));
notify pgrst, 'reload schema';
