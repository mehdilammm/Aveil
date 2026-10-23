-- Verify loop (D5). finding_verifications: the last targeted re-check of a finding (resolved only when the re-check
-- ran and no longer finds it). visibility_rechecks: AI Visibility runs scheduled 7, 14 and 30 days after a fix was
-- verified, one per store and day, listing the fixes they follow. Additive only.
create table public.finding_verifications (
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  finding_key text not null check (char_length(finding_key) <= 300),
  scan_id uuid references public.scans(id) on delete set null,
  status text not null check (status in ('running', 'resolved', 'still_open', 'unavailable')),
  evidence text check (evidence is null or char_length(evidence) <= 1000),
  attempts integer not null default 0 check (attempts >= 0),
  job_id uuid references public.jobs(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (store_id, finding_key)
);
create index finding_verifications_owner_idx on public.finding_verifications(owner_id);
create index finding_verifications_scan_idx on public.finding_verifications(scan_id);
create index finding_verifications_job_idx on public.finding_verifications(job_id);
create index finding_verifications_requested_by_idx on public.finding_verifications(requested_by);
alter table public.finding_verifications enable row level security;
create policy "members read verifications of findings" on public.finding_verifications for select to authenticated using ((select private.store_role(store_id)) is not null);

create table public.visibility_rechecks (
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  due_on date not null,
  day integer not null check (day in (7, 14, 30)),
  finding_keys text[] not null default '{}',
  job_id uuid references public.jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (store_id, due_on)
);
create index visibility_rechecks_owner_idx on public.visibility_rechecks(owner_id);
create index visibility_rechecks_job_idx on public.visibility_rechecks(job_id);
alter table public.visibility_rechecks enable row level security;
create policy "members read visibility rechecks" on public.visibility_rechecks for select to authenticated using ((select private.store_role(store_id)) is not null);
