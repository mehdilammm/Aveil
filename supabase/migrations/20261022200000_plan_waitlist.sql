-- v1.0 pricing: waitlist for the paid plans until payments exist. Server only (no policies, no grants).
create table public.plan_waitlist (
  id uuid primary key default gen_random_uuid(),
  plan text not null check (plan in ('pro', 'agency')),
  email text not null check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now()
);
create unique index plan_waitlist_email_plan_key on public.plan_waitlist(lower(email), plan);
alter table public.plan_waitlist enable row level security;
revoke all on table public.plan_waitlist from anon, authenticated;
