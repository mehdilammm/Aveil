-- AgentScope MVP schema. Every row belongs to one owner; RLS limits access to that owner.

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  url text not null check (url ~* '^https://'),
  platform text not null default 'woocommerce' check (platform in ('woocommerce')),
  connection_status text not null default 'not-connected'
    check (connection_status in ('not-connected', 'connected', 'error')),
  created_at timestamptz not null default now()
);

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'complete', 'failed')),
  data_label text not null default 'OBSERVED' check (data_label in ('OBSERVED', 'SYNTHETIC', 'DEMO')),
  started_at timestamptz,
  finished_at timestamptz,
  published_products integer check (published_products >= 0),
  scanned_products integer check (scanned_products >= 0),
  findings_count integer check (findings_count >= 0),
  severity_counts jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now()
);

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  finding_key text not null,
  type text not null,
  title text not null,
  severity text not null check (severity in ('high', 'medium', 'low')),
  evidence text not null,
  guidance text not null,
  product_id bigint,
  basis text not null default 'observed' check (basis in ('observed', 'heuristic')),
  state text check (state in ('new', 'ongoing', 'recurred')),
  created_at timestamptz not null default now(),
  unique (scan_id, finding_key)
);

create table public.traffic_daily (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  source text not null,
  category text not null,
  confidence text not null,
  route text not null,
  http_status integer not null default 0,
  hits integer not null default 0 check (hits >= 0),
  last_seen timestamptz,
  unique (store_id, day, source, category, confidence, route, http_status)
);

create index stores_owner_idx on public.stores(owner_id);
create index scans_store_idx on public.scans(store_id, created_at desc);
create index scans_owner_idx on public.scans(owner_id);
create index findings_scan_idx on public.findings(scan_id);
create index findings_store_idx on public.findings(store_id);
create index findings_owner_idx on public.findings(owner_id);
create index traffic_store_day_idx on public.traffic_daily(store_id, day);
create index traffic_owner_idx on public.traffic_daily(owner_id);

alter table public.stores enable row level security;
alter table public.scans enable row level security;
alter table public.findings enable row level security;
alter table public.traffic_daily enable row level security;

create policy "owner reads stores" on public.stores for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner adds stores" on public.stores for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "owner edits stores" on public.stores for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "owner removes stores" on public.stores for delete to authenticated using (owner_id = (select auth.uid()));

create policy "owner reads scans" on public.scans for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner reads findings" on public.findings for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner reads traffic" on public.traffic_daily for select to authenticated using (owner_id = (select auth.uid()));
-- Scans, findings and traffic are written only by the server (service role), never directly by the browser.
