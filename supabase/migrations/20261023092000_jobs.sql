-- Background jobs (chunked, idempotent steps, retries). Driven by POST /api/jobs/tick, which pg_cron + pg_net call
-- every minute with a secret header. The secret lives only in Supabase Vault: pg_cron reads it to send the header,
-- the app checks it with jobs_tick_secret_matches() (service role only). It never leaves the database.

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  store_id uuid references public.stores(id) on delete cascade,
  kind text not null check (char_length(kind) between 1 and 40),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt integer not null default 0 check (attempt >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  progress jsonb not null default '{}'::jsonb,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_ready_idx on public.jobs(run_after) where status in ('queued', 'running');
create index jobs_store_idx on public.jobs(store_id, created_at desc);
create index jobs_workspace_idx on public.jobs(workspace_id);
create index jobs_created_by_idx on public.jobs(created_by);

create table public.job_steps (
  job_id uuid not null references public.jobs(id) on delete cascade,
  step_key text not null check (char_length(step_key) between 1 and 120),
  status text not null check (status in ('succeeded', 'failed')),
  attempt integer not null default 1,
  result jsonb,
  updated_at timestamptz not null default now(),
  primary key (job_id, step_key)
);

alter table public.jobs enable row level security;
alter table public.job_steps enable row level security;
create policy "members read jobs" on public.jobs for select to authenticated using (store_id is not null and (select private.store_role(store_id)) is not null);

-- Claims one ready job (queued, or running with an expired lock) for `p_seconds`; SKIP LOCKED so ticks never collide.
create or replace function public.claim_job(p_seconds integer)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.jobs j
  set status = 'running', attempt = j.attempt + 1, locked_until = now() + make_interval(secs => p_seconds), updated_at = now()
  where j.id = (
    select id from public.jobs
    where run_after <= now() and (status = 'queued' or (status = 'running' and locked_until < now()))
    order by run_after
    limit 1
    for update skip locked
  )
  returning j.*;
end;
$$;

-- Tick secret, created once in Vault.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'jobs_tick_secret', 'Header secret for /api/jobs/tick')
where not exists (select 1 from vault.secrets where name = 'jobs_tick_secret');

create or replace function public.jobs_tick_secret_matches(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Hashes are compared, so the comparison's timing says nothing about the secret itself.
  select coalesce((
    select extensions.digest(decrypted_secret, 'sha256') = extensions.digest(coalesce(p_secret, ''), 'sha256') and char_length(coalesce(p_secret, '')) >= 32
    from vault.decrypted_secrets where name = 'jobs_tick_secret'
  ), false);
$$;

revoke all on function public.claim_job(integer) from public, anon, authenticated;
revoke all on function public.jobs_tick_secret_matches(text) from public, anon, authenticated;
grant execute on function public.claim_job(integer) to service_role;
grant execute on function public.jobs_tick_secret_matches(text) to service_role;
