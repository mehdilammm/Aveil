-- v0.4 AI Visibility: questions per store, runs against an AI engine (Gemini API first), and stored answers.

create table public.visibility_prompts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  prompt text not null check (char_length(prompt) between 3 and 300),
  created_at timestamptz not null default now()
);
create unique index visibility_prompts_store_prompt_key on public.visibility_prompts(store_id, lower(prompt));
create index visibility_prompts_owner_idx on public.visibility_prompts(owner_id);

-- At most 15 questions per store.
create or replace function public.visibility_prompts_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.visibility_prompts where store_id = new.store_id) >= 15 then
    raise exception 'A store can have at most 15 questions' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger visibility_prompts_limit before insert on public.visibility_prompts
  for each row execute function public.visibility_prompts_limit();

create table public.visibility_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  engine text not null default 'gemini' check (engine in ('gemini')),
  model text not null,
  grounding boolean not null default false,
  status text not null default 'running' check (status in ('running', 'complete', 'failed')),
  prompts_count integer not null default 0 check (prompts_count >= 0),
  requests_count integer not null default 0 check (requests_count >= 0),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index visibility_runs_store_idx on public.visibility_runs(store_id, created_at desc);
create index visibility_runs_owner_idx on public.visibility_runs(owner_id);

create table public.visibility_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.visibility_runs(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  prompt_id uuid references public.visibility_prompts(id) on delete set null,
  prompt text not null,
  answer text,
  mentioned boolean,
  mention_rank integer check (mention_rank is null or mention_rank >= 1),
  matched_terms text[] not null default '{}',
  competitors jsonb not null default '[]'::jsonb,
  urls jsonb not null default '[]'::jsonb,
  finish_reason text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  error text,
  created_at timestamptz not null default now()
);
create index visibility_results_run_idx on public.visibility_results(run_id);
create index visibility_results_store_idx on public.visibility_results(store_id, created_at desc);
create index visibility_results_owner_idx on public.visibility_results(owner_id);
create index visibility_results_prompt_idx on public.visibility_results(prompt_id);

alter table public.visibility_prompts enable row level security;
alter table public.visibility_runs enable row level security;
alter table public.visibility_results enable row level security;

-- Owners manage their own questions; runs and results are written only by the server (service role).
create policy "owner reads prompts" on public.visibility_prompts for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner adds prompts" on public.visibility_prompts for insert to authenticated
  with check (owner_id = (select auth.uid()) and exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));
create policy "owner removes prompts" on public.visibility_prompts for delete to authenticated using (owner_id = (select auth.uid()));
create policy "owner reads runs" on public.visibility_runs for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner reads results" on public.visibility_results for select to authenticated using (owner_id = (select auth.uid()));

revoke all on function public.visibility_prompts_limit() from public, anon, authenticated;
