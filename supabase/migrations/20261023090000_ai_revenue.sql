-- v1.1 AI Revenue: AI-referred orders (from WooCommerce Order Attribution) and the plan of each workspace.
-- Only non-personal fields are stored: order id, date, total, currency, AI source, how it was matched, entry path,
-- and whether the order shows agent-checkout evidence. No name, email, phone, address or IP.

alter table public.workspaces add column plan text not null default 'free' check (plan in ('free', 'pro', 'agency'));

create table public.ai_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  order_id bigint not null check (order_id > 0),
  ordered_at timestamptz not null,
  total numeric(14, 2) not null default 0,
  currency text not null default '' check (currency = '' or currency ~ '^[A-Z]{3}$'),
  source text not null check (char_length(source) between 1 and 40),
  via text not null check (via in ('utm_source', 'referrer', 'session_entry')),
  entry_path text check (entry_path is null or char_length(entry_path) <= 200),
  agent_checkout boolean not null default false,
  created_at timestamptz not null default now(),
  unique (store_id, order_id)
);
create index ai_orders_store_idx on public.ai_orders(store_id, ordered_at desc);
create index ai_orders_owner_idx on public.ai_orders(owner_id);

-- Result of the last order read per store (counts only).
create table public.order_syncs (
  store_id uuid primary key references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  synced_at timestamptz not null default now(),
  status text not null check (status in ('ok', 'unavailable', 'error')),
  reason text,
  orders_scanned integer not null default 0 check (orders_scanned >= 0),
  with_attribution integer not null default 0 check (with_attribution >= 0),
  ai_orders integer not null default 0 check (ai_orders >= 0),
  agent_checkouts integer not null default 0 check (agent_checkouts >= 0)
);
create index order_syncs_owner_idx on public.order_syncs(owner_id);

alter table public.ai_orders enable row level security;
alter table public.order_syncs enable row level security;
-- Members of the store's workspace read; only the server writes.
create policy "members read ai orders" on public.ai_orders for select to authenticated using ((select private.store_role(store_id)) is not null);
create policy "members read order syncs" on public.order_syncs for select to authenticated using ((select private.store_role(store_id)) is not null);
