-- Billing / approval columns may only change from the server (service_role).
-- Users can still rename a workspace and edit a store's name, url and bot log retention.

revoke update on public.workspaces from authenticated, anon;
grant update (name) on public.workspaces to authenticated;

revoke update on public.stores from authenticated, anon;
grant update (name, url, bot_hit_retention_days) on public.stores to authenticated;

-- Defense in depth: TRUNCATE, TRIGGER and REFERENCES are never needed by API roles,
-- and TRUNCATE is not covered by RLS.
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t);
  end loop;
end $$;
