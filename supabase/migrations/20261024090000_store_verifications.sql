-- Ownership verification per store and method. The token is public by design (it is published in DNS or on the
-- site), so it is stored as is. Members read; only the server writes.
create table public.store_verifications (
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  method text not null check (method in ('api_key', 'dns_txt', 'meta_tag', 'well_known_file', 'plugin', 'oauth')),
  token text check (token is null or token ~ '^[0-9a-f]{32}$'),
  verified_at timestamptz,
  expires_at timestamptz,
  checked_at timestamptz,
  evidence text check (evidence is null or char_length(evidence) <= 500),
  created_at timestamptz not null default now(),
  primary key (store_id, method)
);
create index store_verifications_owner_idx on public.store_verifications(owner_id);
alter table public.store_verifications enable row level security;
create policy "members read verifications" on public.store_verifications for select to authenticated using ((select private.store_role(store_id)) is not null);
