-- Scans run as background jobs, step by step (B9), with a per-scan cost log (B6), the plan's product sample (B8)
-- and the JSON-LD source of each sampled product page (B3). Additive only: no existing row is changed.
alter table public.findings add column job_step text check (job_step is null or char_length(job_step) <= 120);
create index findings_scan_step_idx on public.findings(scan_id, job_step);

alter table public.scans
  add column requests_count integer check (requests_count is null or requests_count >= 0),
  add column cost_usd_micros bigint not null default 0 check (cost_usd_micros >= 0),
  add column sampled_products integer check (sampled_products is null or sampled_products >= 0),
  add column sample_basis text check (sample_basis is null or sample_basis in ('sales', 'category_coverage'));

create table public.scan_schema_pages (
  scan_id uuid not null references public.scans(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null,
  url text not null check (char_length(url) <= 2000),
  primary_source text check (primary_source is null or primary_source in ('woocommerce', 'yoast', 'rank_math', 'theme_or_other')),
  primary_id text check (primary_id is null or char_length(primary_id) <= 2000),
  duplicate boolean not null default false,
  sources text[] not null default '{}',
  error text check (error is null or char_length(error) <= 300),
  created_at timestamptz not null default now(),
  primary key (scan_id, product_id)
);
create index scan_schema_pages_store_idx on public.scan_schema_pages(store_id, created_at desc);
create index scan_schema_pages_owner_idx on public.scan_schema_pages(owner_id);
alter table public.scan_schema_pages enable row level security;
create policy "members read schema pages" on public.scan_schema_pages for select to authenticated using ((select private.store_role(store_id)) is not null);
