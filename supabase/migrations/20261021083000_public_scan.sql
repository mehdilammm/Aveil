-- v0.5 public scan (no login). Server only: RLS on, no policies, no grants for browser roles.
-- Reports are read by the server and shown at /check/<random id>; they expire after 30 days.
create table public.public_reports (
  id uuid primary key default gen_random_uuid(),
  host text not null check (char_length(host) between 3 and 253),
  url text not null check (url ~* '^https://'),
  status text not null default 'running' check (status in ('running', 'complete', 'failed')),
  report jsonb,
  error text,
  http_requests integer not null default 0 check (http_requests >= 0),
  gemini_requests integer not null default 0 check (gemini_requests >= 0),
  gemini_input_tokens integer not null default 0 check (gemini_input_tokens >= 0),
  gemini_output_tokens integer not null default 0 check (gemini_output_tokens >= 0),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 days'
);
create index public_reports_host_idx on public.public_reports(host, created_at desc);
create index public_reports_expires_idx on public.public_reports(expires_at);

-- Rate limit per visitor. ip_hash is an HMAC of the IP with a server secret and the day, so it cannot be
-- reversed or linked across days; rows older than a day are removed on every check.
create table public.public_scan_limits (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null default now(),
  count integer not null default 0
);

-- Gemini calls made by public scans, per UTC day.
create table public.public_gemini_usage (
  day date primary key,
  count integer not null default 0
);

alter table public.public_reports enable row level security;
alter table public.public_scan_limits enable row level security;
alter table public.public_gemini_usage enable row level security;
revoke all on table public.public_reports from anon, authenticated;
revoke all on table public.public_scan_limits from anon, authenticated;
revoke all on table public.public_gemini_usage from anon, authenticated;

-- Counts one scan for this visitor and returns the count in the current window.
create or replace function public.public_scan_hit(p_ip_hash text, p_window_seconds integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.public_scan_limits where window_start < now() - interval '1 day';
  insert into public.public_scan_limits as l (ip_hash, window_start, count)
  values (p_ip_hash, now(), 1)
  on conflict (ip_hash) do update
    set count = case when l.window_start < now() - make_interval(secs => p_window_seconds) then 1 else l.count + 1 end,
        window_start = case when l.window_start < now() - make_interval(secs => p_window_seconds) then now() else l.window_start end
  returning count into v_count;
  return v_count;
end;
$$;

-- Reserves one Gemini call for today; returns false when the daily limit is reached.
create or replace function public.public_gemini_reserve(p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.public_gemini_usage as u (day, count) values ((now() at time zone 'utc')::date, 1)
  on conflict (day) do update set count = u.count + 1
  where u.count < p_limit
  returning count into v_count;
  return v_count is not null;
end;
$$;

-- Removes expired reports.
create or replace function public.public_reports_cleanup()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.public_reports where expires_at < now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.public_scan_hit(text, integer) from public, anon, authenticated;
revoke all on function public.public_gemini_reserve(integer) from public, anon, authenticated;
revoke all on function public.public_reports_cleanup() from public, anon, authenticated;
grant execute on function public.public_scan_hit(text, integer) to service_role;
grant execute on function public.public_gemini_reserve(integer) to service_role;
grant execute on function public.public_reports_cleanup() to service_role;
