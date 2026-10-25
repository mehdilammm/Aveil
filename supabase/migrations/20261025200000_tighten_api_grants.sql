-- Security (Low): table privileges match the RLS policies. RLS already refuses these, this removes the grants too.
-- anon: the app never reads or writes tables with the public key while signed out (public pages use the
-- server), and no policy is for anon, so anon has no table privilege in public.
-- authenticated: SELECT stays (RLS policies decide which rows). Writes only where a policy allows them:
--   stores: insert (name, url, owner_id, workspace_id), update (name, bot_hit_retention_days), delete
--   visibility_prompts: insert, delete
--   workspaces: update (name)
-- Everything else is written by the server (service_role). Future tables start with the same rule.
do $$
declare t text;
begin
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  loop
    execute format('revoke all on public.%I from anon', t);
    if t not in ('stores', 'visibility_prompts', 'workspaces') then
      execute format('revoke insert, update, delete on public.%I from authenticated', t);
    end if;
  end loop;
end $$;

-- workspaces: no insert or delete policy for signed-in users (the server creates and deletes them).
revoke insert, delete on public.workspaces from authenticated;
-- visibility_prompts: no update policy.
revoke update on public.visibility_prompts from authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke insert, update, delete, truncate, references, trigger on tables from authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
