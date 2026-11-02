-- N5 (Cloudflare security-audit run 1): the per-workspace store limit of the plan is enforced in the database, so a
-- direct REST insert (authenticated has INSERT on stores under RLS) cannot go past it. Same numbers as lib/plans.ts
-- (free 1, pro 3, agency 10; a test keeps them equal). The workspace row is locked, so two inserts at once cannot
-- both pass. Service-role inserts are checked too (the app checks the same limit first and shows a plain message).
create or replace function private.enforce_store_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_limit int;
  v_count int;
begin
  select w.plan into v_plan from public.workspaces w where w.id = new.workspace_id for update;
  v_limit := case v_plan when 'agency' then 10 when 'pro' then 3 else 1 end;
  select count(*) into v_count from public.stores s where s.workspace_id = new.workspace_id;
  if v_count >= v_limit then
    raise exception 'store limit reached: the % plan has % store(s) per workspace', coalesce(v_plan, 'free'), v_limit
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_store_limit() from public, anon, authenticated;

drop trigger if exists stores_enforce_plan_limit on public.stores;
create trigger stores_enforce_plan_limit
  before insert on public.stores
  for each row execute function private.enforce_store_limit();
