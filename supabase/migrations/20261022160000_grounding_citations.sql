-- v0.9 Citations: AI Visibility questions can be asked to Gemini with Google Search grounding
-- (GEMINI_GROUNDING_ENABLED=true). The sources each answer relied on are stored per result, and an app-wide monthly
-- counter stops grounding at a fixed cap (1000 in the code, below the 5,000 free grounded prompts per month).

alter table public.visibility_results add column citations jsonb;
alter table public.visibility_results add column grounded boolean not null default false;

create table public.grounding_usage (
  month date primary key,
  count integer not null default 0 check (count >= 0)
);
alter table public.grounding_usage enable row level security;
revoke all on table public.grounding_usage from anon, authenticated;

-- Reserves one grounded request in this month's budget; false when the cap is reached.
create or replace function public.grounding_reserve(p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.grounding_usage as u (month, count)
  select date_trunc('month', now() at time zone 'utc')::date, 1
  where p_limit >= 1
  on conflict (month) do update set count = u.count + 1
  where u.count + 1 <= p_limit
  returning count into v_count;
  return v_count is not null;
end;
$$;

-- Counts retries without a limit check, so the monthly total stays accurate.
create or replace function public.grounding_record(p_n integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.grounding_usage as u (month, count)
  values (date_trunc('month', now() at time zone 'utc')::date, greatest(p_n, 0))
  on conflict (month) do update set count = u.count + greatest(p_n, 0);
$$;

revoke all on function public.grounding_reserve(integer) from public, anon, authenticated;
revoke all on function public.grounding_record(integer) from public, anon, authenticated;
grant execute on function public.grounding_reserve(integer) to service_role;
grant execute on function public.grounding_record(integer) to service_role;
