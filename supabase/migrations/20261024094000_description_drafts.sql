-- Description optimizer drafts (D3): the product's text when the draft was made, the proposal, the merchant's
-- inputs and the flagged unknowns. Approved drafts are exported (CSV, copy); nothing is written to the store.
create table public.description_drafts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null check (product_id > 0),
  product_name text not null check (char_length(product_name) <= 300),
  current_html text not null default '' check (char_length(current_html) <= 100000),
  proposed_html text not null check (char_length(proposed_html) <= 100000),
  inputs jsonb not null default '{}'::jsonb,
  unknowns text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'approved', 'discarded')),
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, product_id)
);
create index description_drafts_owner_idx on public.description_drafts(owner_id);
create index description_drafts_created_by_idx on public.description_drafts(created_by);
create index description_drafts_approved_by_idx on public.description_drafts(approved_by);
alter table public.description_drafts enable row level security;
create policy "members read description drafts" on public.description_drafts for select to authenticated using ((select private.store_role(store_id)) is not null);
