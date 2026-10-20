-- WooCommerce API credentials, encrypted by the app server (AES-256-GCM).
-- Server-only: RLS on with no policies, and no grants for browser roles.
create table public.store_credentials (
  store_id uuid primary key references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  consumer_key_enc text not null,
  consumer_secret_enc text not null,
  key_hint text not null check (char_length(key_hint) <= 16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.store_credentials enable row level security;
revoke all on table public.store_credentials from anon, authenticated;

create index store_credentials_owner_id_idx on public.store_credentials(owner_id);
