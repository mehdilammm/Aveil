-- v0.7: Mistral as a second AI Visibility engine.
-- A run can now ask several engines; each result row says which engine answered and which one extracted names.
alter table public.visibility_runs drop constraint visibility_runs_engine_check;
alter table public.visibility_runs add constraint visibility_runs_engine_check check (engine in ('gemini', 'mistral', 'multi'));

alter table public.visibility_results add column engine text not null default 'gemini' check (engine in ('gemini', 'mistral'));
alter table public.visibility_results add column model text;
alter table public.visibility_results add column extractor text check (extractor is null or extractor in ('gemini', 'mistral'));
alter table public.visibility_results add column requests integer not null default 0 check (requests >= 0);

-- Public check: Mistral usage per report and an app-wide daily Mistral budget, like Gemini's.
alter table public.public_reports add column mistral_requests integer not null default 0 check (mistral_requests >= 0);
alter table public.public_reports add column mistral_input_tokens integer not null default 0 check (mistral_input_tokens >= 0);
alter table public.public_reports add column mistral_output_tokens integer not null default 0 check (mistral_output_tokens >= 0);

create table public.public_mistral_usage (
  day date primary key,
  count integer not null default 0
);
alter table public.public_mistral_usage enable row level security;
revoke all on table public.public_mistral_usage from anon, authenticated;

create or replace function public.public_mistral_reserve_n(p_limit integer, p_n integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_n < 1 or p_n > p_limit then
    return false;
  end if;
  insert into public.public_mistral_usage as u (day, count)
  select (now() at time zone 'utc')::date, p_n
  on conflict (day) do update set count = u.count + p_n
  where u.count + p_n <= p_limit
  returning count into v_count;
  return v_count is not null;
end;
$$;

create or replace function public.public_mistral_record(p_n integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.public_mistral_usage as u (day, count) values ((now() at time zone 'utc')::date, greatest(p_n, 0))
  on conflict (day) do update set count = u.count + greatest(p_n, 0);
$$;

revoke all on function public.public_mistral_reserve_n(integer, integer) from public, anon, authenticated;
revoke all on function public.public_mistral_record(integer) from public, anon, authenticated;
grant execute on function public.public_mistral_reserve_n(integer, integer) to service_role;
grant execute on function public.public_mistral_record(integer) to service_role;
