-- Who started a scan: a person (manual) or the weekly schedule.
alter table public.scans add column trigger text not null default 'manual'
  check (trigger in ('manual', 'scheduled'));
