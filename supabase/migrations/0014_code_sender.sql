-- The phone number a store's verification codes come from (the CRM or the person forwarding them).
-- Codes are matched to a store by the JustCall line they arrive on, or by this sender number.
alter table dealerships add column if not exists code_sender_number text;
notify pgrst, 'reload schema';
