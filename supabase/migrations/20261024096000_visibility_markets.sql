-- C1: each question is written for a market in its language; each answer records the market, language and
-- access method (S9). Existing rows keep null (shown as "not recorded"). The per-store question limit follows
-- the highest plan (25; each plan's own limit is enforced by the app).
alter table public.visibility_prompts
  add column market text check (market is null or market in ('US', 'UK', 'SA', 'AE', 'MA', 'FR')),
  add column language text check (language is null or language in ('en', 'ar', 'fr'));
alter table public.visibility_results
  add column country text check (country is null or country in ('US', 'UK', 'SA', 'AE', 'MA', 'FR')),
  add column language text check (language is null or language in ('en', 'ar', 'fr')),
  add column access_method text check (access_method is null or char_length(access_method) <= 80);

create or replace function public.visibility_prompts_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.visibility_prompts where store_id = new.store_id) >= 25 then
    raise exception 'A store can have at most 25 questions' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
