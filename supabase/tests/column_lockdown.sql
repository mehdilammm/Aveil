-- Column lock-down test (migration lock_down_column_updates). As a signed-in workspace owner (the role a browser
-- gets with the public key), in one transaction that is rolled back. Expected: rename and retention allowed;
-- plan, auto_fix_enabled, owner_id, connection_status and truncate refused (42501); member role rows=0 (no policy).
begin;
create temp table t_res (test text, outcome text);
grant all on t_res to authenticated;
select set_config('request.jwt.claims', json_build_object('sub','d402b434-591f-40d7-b7f5-326a456d301e','role','authenticated')::text, true);
set local role authenticated;
do $$
declare n int;
begin
  begin update public.workspaces set name = name || ' x' where id = 'cd674fa4-58ce-41aa-a61d-81462a47dd91'; get diagnostics n = row_count; insert into t_res values ('rename workspace (owner)', 'allowed, rows=' || n);
  exception when others then insert into t_res values ('rename workspace (owner)', 'refused ' || sqlstate); end;
  begin update public.workspaces set plan = 'agency' where id = 'cd674fa4-58ce-41aa-a61d-81462a47dd91'; insert into t_res values ('workspaces.plan', 'ALLOWED');
  exception when others then insert into t_res values ('workspaces.plan', 'refused ' || sqlstate); end;
  begin update public.stores set bot_hit_retention_days = 30 where id = 'c2ab0cfe-d60a-4d93-ae3e-983598108948'; get diagnostics n = row_count; insert into t_res values ('stores.bot_hit_retention_days', 'allowed, rows=' || n);
  exception when others then insert into t_res values ('stores.bot_hit_retention_days', 'refused ' || sqlstate); end;
  begin update public.stores set auto_fix_enabled = true where id = 'c2ab0cfe-d60a-4d93-ae3e-983598108948'; insert into t_res values ('stores.auto_fix_enabled', 'ALLOWED');
  exception when others then insert into t_res values ('stores.auto_fix_enabled', 'refused ' || sqlstate); end;
  begin update public.stores set owner_id = gen_random_uuid() where id = 'c2ab0cfe-d60a-4d93-ae3e-983598108948'; insert into t_res values ('stores.owner_id', 'ALLOWED');
  exception when others then insert into t_res values ('stores.owner_id', 'refused ' || sqlstate); end;
  begin update public.stores set connection_status = 'connected' where id = 'c2ab0cfe-d60a-4d93-ae3e-983598108948'; insert into t_res values ('stores.connection_status', 'ALLOWED');
  exception when others then insert into t_res values ('stores.connection_status', 'refused ' || sqlstate); end;
  begin update public.workspace_members set role = 'owner' where workspace_id = 'cd674fa4-58ce-41aa-a61d-81462a47dd91'; get diagnostics n = row_count; insert into t_res values ('workspace_members.role', 'rows=' || n);
  exception when others then insert into t_res values ('workspace_members.role', 'refused ' || sqlstate); end;
  begin truncate public.findings; insert into t_res values ('truncate findings', 'ALLOWED');
  exception when others then insert into t_res values ('truncate findings', 'refused ' || sqlstate); end;
end $$;
reset role;
select * from t_res;
rollback;
