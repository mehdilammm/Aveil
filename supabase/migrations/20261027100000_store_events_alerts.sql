-- F2 / F3 (to approve): what the plugin reports changed on the store, and the alerts the app raises from it.
-- store_events: one row per change the plugin saw (plugin / theme / core update, theme switch, plugin on/off,
-- product published / updated): names and version numbers only, no visitor or customer data. Deduplicated on the
-- plugin's event id. store_alerts: a breakage alert (a problem a mini-scan found after a change) or a new-product
-- check result. Members read; the server writes; additive only.
create table public.store_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null,
  kind text not null check (kind in ('plugin_updated', 'theme_updated', 'core_updated', 'theme_switched', 'plugin_activated', 'plugin_deactivated', 'product_published', 'product_updated')),
  subject text check (subject is null or char_length(subject) <= 200),
  slug text check (slug is null or char_length(slug) <= 200),
  old_version text check (old_version is null or char_length(old_version) <= 40),
  new_version text check (new_version is null or char_length(new_version) <= 40),
  product_id bigint check (product_id is null or product_id > 0),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  job_id uuid references public.jobs(id) on delete set null,
  unique (store_id, event_id)
);
create index store_events_store_idx on public.store_events(store_id, occurred_at desc);
create index store_events_owner_idx on public.store_events(owner_id);
create index store_events_job_idx on public.store_events(job_id);
alter table public.store_events enable row level security;
create policy "members read store events" on public.store_events for select to authenticated using ((select private.store_role(store_id)) is not null);

create table public.store_alerts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('breakage', 'product_check')),
  status text not null default 'open' check (status in ('open', 'dismissed')),
  title text not null check (char_length(title) between 1 and 300),
  detail jsonb not null default '{}'::jsonb,
  event_ids uuid[] not null default '{}',
  job_id uuid references public.jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  dismissed_at timestamptz,
  dismissed_by uuid references auth.users(id) on delete set null
);
create index store_alerts_store_idx on public.store_alerts(store_id, created_at desc);
create index store_alerts_open_idx on public.store_alerts(store_id) where status = 'open';
create index store_alerts_owner_idx on public.store_alerts(owner_id);
create index store_alerts_job_idx on public.store_alerts(job_id);
create index store_alerts_dismissed_by_idx on public.store_alerts(dismissed_by);
alter table public.store_alerts enable row level security;
create policy "members read store alerts" on public.store_alerts for select to authenticated using ((select private.store_role(store_id)) is not null);

revoke all on public.store_events, public.store_alerts from anon;
revoke insert, update, delete, truncate, references, trigger on public.store_events, public.store_alerts from authenticated;
