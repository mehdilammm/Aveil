-- Reserve n Gemini requests at once (question + its extraction), so an asked question always gets its extraction.
create or replace function public.public_gemini_reserve_n(p_limit integer, p_n integer)
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
  insert into public.public_gemini_usage as u (day, count)
  select (now() at time zone 'utc')::date, p_n
  where p_n <= p_limit
  on conflict (day) do update set count = u.count + p_n
  where u.count + p_n <= p_limit
  returning count into v_count;
  return v_count is not null;
end;
$$;

-- Counts extra requests (retries) without a limit check, so the daily total stays accurate.
create or replace function public.public_gemini_record(p_n integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.public_gemini_usage as u (day, count) values ((now() at time zone 'utc')::date, greatest(p_n, 0))
  on conflict (day) do update set count = u.count + greatest(p_n, 0);
$$;

revoke all on function public.public_gemini_reserve_n(integer, integer) from public, anon, authenticated;
revoke all on function public.public_gemini_record(integer) from public, anon, authenticated;
grant execute on function public.public_gemini_reserve_n(integer, integer) to service_role;
grant execute on function public.public_gemini_record(integer) to service_role;

-- Shopify waitlist from the public check. Email is optional; nothing is sent. Server only.
create table public.shopify_waitlist (
  id uuid primary key default gen_random_uuid(),
  host text not null check (char_length(host) between 3 and 253),
  email text check (email is null or (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  report_id uuid references public.public_reports(id) on delete set null,
  created_at timestamptz not null default now()
);
create index shopify_waitlist_host_idx on public.shopify_waitlist(host);
create index shopify_waitlist_report_idx on public.shopify_waitlist(report_id);
create unique index shopify_waitlist_email_host_key on public.shopify_waitlist(lower(email), host) where email is not null;
alter table public.shopify_waitlist enable row level security;
revoke all on table public.shopify_waitlist from anon, authenticated;
