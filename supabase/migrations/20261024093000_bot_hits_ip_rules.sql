-- Bot hit IP rules (approved 2026-10-23): the IP of a hit that is not in the operator's published list (or Google's
-- reverse DNS) is deleted as soon as it is checked, since it may be a person using a bot's name; only the
-- user-agent claim is kept. Verified IPs are kept at most 90 days. No existing row changes (the table is empty).
alter table public.bot_hits alter column ip drop not null;
alter table public.bot_hits add constraint bot_hits_unverified_no_ip check (verified is distinct from false or ip is null);
alter table public.stores drop constraint stores_bot_hit_retention_days_check;
alter table public.stores add constraint stores_bot_hit_retention_days_check check (bot_hit_retention_days between 7 and 90);
