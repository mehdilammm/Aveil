-- Grounding: a small daily cap on top of the monthly one, so the free tier's daily grounding limit is not reached.
create table public.grounding_usage_daily (
  day date primary key,
  count integer not null default 0 check (count >= 0)
);
alter table public.grounding_usage_daily enable row level security;
revoke all on table public.grounding_usage_daily from anon, authenticated;

-- Reserves one grounded request if both this month's and today's counts stay within their caps.
create or replace function public.grounding_reserve_capped(p_month_limit integer, p_day_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_day date := (now() at time zone 'utc')::date;
  v_count integer;
begin
  insert into public.grounding_usage_daily as d (day, count)
  select v_day, 1 where p_day_limit >= 1
  on conflict (day) do update set count = d.count + 1 where d.count + 1 <= p_day_limit
  returning count into v_count;
  if v_count is null then
    return false;
  end if;
  v_count := null;
  insert into public.grounding_usage as u (month, count)
  select v_month, 1 where p_month_limit >= 1
  on conflict (month) do update set count = u.count + 1 where u.count + 1 <= p_month_limit
  returning count into v_count;
  if v_count is null then
    update public.grounding_usage_daily set count = count - 1 where day = v_day;
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.grounding_reserve_capped(integer, integer) from public, anon, authenticated;
grant execute on function public.grounding_reserve_capped(integer, integer) to service_role;
