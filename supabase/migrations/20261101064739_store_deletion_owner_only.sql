-- M2 (security audit 2026-10-31): a store is deleted only by the workspace owner, through the server, with a record.
-- The browser (authenticated role) can no longer delete a store directly through the REST API.

create table if not exists public.store_deletions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  workspace_id uuid,
  store_name text not null,
  store_url text not null,
  deleted_by uuid not null,
  deleted_at timestamptz not null default now()
);
comment on table public.store_deletions is 'Who deleted which store and when. Written by the server only (service role).';
alter table public.store_deletions enable row level security;
revoke all on public.store_deletions from anon, authenticated;

revoke delete on public.stores from authenticated;
drop policy if exists "editors remove stores" on public.stores;
drop policy if exists "owner removes stores" on public.stores;
