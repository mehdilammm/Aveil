-- G3: shareable report links for a store's scan. The page shows a frozen snapshot (made when the link is created)
-- with findings titles, severities, bases and areas only: no order, revenue, key, token, IP, email or settings
-- value. The link token is stored hashed; links expire (7–90 days) and can be revoked. Members read; server writes.
create table public.share_reports (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid references public.scans(id) on delete set null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  views integer not null default 0 check (views >= 0)
);
create index share_reports_store_idx on public.share_reports(store_id, created_at desc);
create index share_reports_owner_idx on public.share_reports(owner_id);
create index share_reports_scan_idx on public.share_reports(scan_id);
create index share_reports_created_by_idx on public.share_reports(created_by);
alter table public.share_reports enable row level security;
create policy "members read share reports" on public.share_reports for select to authenticated using ((select private.store_role(store_id)) is not null);
revoke all on table public.share_reports from anon;
revoke insert, update, delete, truncate on table public.share_reports from authenticated;
