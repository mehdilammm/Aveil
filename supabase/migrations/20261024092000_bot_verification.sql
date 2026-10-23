-- Bot verification (B5). Additive only.
-- bot_ip_ranges: the operators' published IP lists, cached by the server (service role only).
-- bot_hits: requests whose user agent is a known AI bot, sent by the plugin in batches: time, bot, IP, full user
-- agent, path, method, status. Human visitors are never sent. Kept bot_hit_retention_days (default 90), then purged.
create table public.bot_ip_ranges (
  url text primary key check (url ~ '^https://'),
  provider text not null check (provider in ('openai', 'anthropic', 'perplexity', 'google')),
  bots text[] not null,
  cidrs text[] not null default '{}',
  creation_time text,
  status text not null check (status in ('ok', 'unavailable')),
  reason text check (reason is null or char_length(reason) <= 300),
  fetched_at timestamptz not null default now()
);
alter table public.bot_ip_ranges enable row level security;

alter table public.stores add column bot_hit_retention_days integer not null default 90 check (bot_hit_retention_days between 7 and 365);

create table public.bot_hits (
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  hit_id uuid not null,
  seen_at timestamptz not null,
  bot text not null check (char_length(bot) between 1 and 40),
  ip inet not null,
  user_agent text not null check (char_length(user_agent) <= 500),
  url_path text not null check (char_length(url_path) <= 500),
  method text not null check (method in ('GET', 'HEAD', 'POST')),
  http_status integer check (http_status is null or http_status between 100 and 599),
  verified boolean,
  verify_method text check (verify_method is null or verify_method in ('ip_range', 'rdns')),
  verify_detail text check (verify_detail is null or char_length(verify_detail) <= 200),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (store_id, hit_id)
);
create index bot_hits_store_seen_idx on public.bot_hits(store_id, seen_at desc);
create index bot_hits_unverified_idx on public.bot_hits(created_at) where verified is null;
create index bot_hits_owner_idx on public.bot_hits(owner_id);
alter table public.bot_hits enable row level security;
create policy "members read bot hits" on public.bot_hits for select to authenticated using ((select private.store_role(store_id)) is not null);
