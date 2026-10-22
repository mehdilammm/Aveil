-- Daily AI usage per workspace (requests, tokens, cost in micro-dollars) for the per-plan daily caps and alerts.
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  kind text not null check (char_length(kind) between 1 and 40),
  ref_id uuid,
  provider text not null check (provider in ('gemini', 'mistral', 'groq', 'nvidia')),
  requests integer not null default 0 check (requests >= 0),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd_micros bigint not null default 0 check (cost_usd_micros >= 0),
  created_at timestamptz not null default now()
);
create index usage_events_workspace_day_idx on public.usage_events(workspace_id, created_at desc);
create index usage_events_store_idx on public.usage_events(store_id);
alter table public.usage_events enable row level security;
-- Members read their workspace's usage; only the server writes.
create policy "members read usage" on public.usage_events for select to authenticated using ((select private.ws_role(workspace_id)) is not null);
