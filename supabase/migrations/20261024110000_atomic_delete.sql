-- G1 fix: hard delete in one database transaction. delete_workspace() checks the caller owns the workspace,
-- deletes it (foreign keys cascade to every table that has its workspace_id or one of its stores' store_id; the
-- delete triggers remove the Vault secrets), then checks that nothing is left: any remaining row or secret raises,
-- which rolls the whole delete back. delete_account_data() does the same for every workspace the user owns and
-- their waitlist sign-ups, in one transaction (the auth user is deleted by the app afterwards). Additive only.
create or replace function public.delete_workspace(p_workspace_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_stores uuid[];
  v_secrets uuid[];
  v_left bigint;
  v_tbl text;
  v_col text;
begin
  if not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_user_id and role = 'owner') then
    raise exception 'only the owner can delete this workspace' using errcode = '42501';
  end if;
  select coalesce(array_agg(id), '{}') into v_stores from public.stores where workspace_id = p_workspace_id;
  select coalesce(array_agg(x), '{}') into v_secrets from (
    select unnest(array[consumer_key_secret_id, consumer_secret_secret_id]) x from public.store_credentials where store_id = any(v_stores)
    union all select unnest(array[consumer_key_secret_id, consumer_secret_secret_id]) from public.store_write_credentials where store_id = any(v_stores)
    union all select secret_id from public.traffic_connectors where store_id = any(v_stores)
  ) s where x is not null;

  delete from public.workspaces where id = p_workspace_id;

  -- Nothing may be left: every public table with workspace_id or store_id, and the Vault secrets.
  for v_tbl, v_col in
    select c.table_name, c.column_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name in ('workspace_id', 'store_id')
  loop
    if v_col = 'workspace_id' then
      execute format('select count(*) from public.%I where workspace_id = $1', v_tbl) into v_left using p_workspace_id;
    else
      execute format('select count(*) from public.%I where store_id = any($1)', v_tbl) into v_left using v_stores;
    end if;
    if v_left > 0 then
      raise exception 'delete incomplete: % rows left in %', v_left, v_tbl;
    end if;
  end loop;
  select count(*) into v_left from public.workspaces where id = p_workspace_id;
  if v_left > 0 then raise exception 'delete incomplete: the workspace row is left'; end if;
  select count(*) into v_left from vault.secrets where id = any(v_secrets);
  if v_left > 0 then raise exception 'delete incomplete: % Vault secrets left', v_left; end if;

  return jsonb_build_object('workspace_id', p_workspace_id, 'stores', coalesce(array_length(v_stores, 1), 0), 'secrets', coalesce(array_length(v_secrets, 1), 0));
end;
$$;

create or replace function public.delete_account_data(p_user_id uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid;
  v_done jsonb := '[]'::jsonb;
begin
  if exists (
    select 1 from public.stores s
    where s.owner_id = p_user_id
      and not exists (select 1 from public.workspace_members m where m.workspace_id = s.workspace_id and m.user_id = p_user_id and m.role = 'owner')
  ) then
    raise exception 'first remove the stores you added to other workspaces' using errcode = 'P0001';
  end if;
  for v_ws in select workspace_id from public.workspace_members where user_id = p_user_id and role = 'owner' loop
    v_done := v_done || public.delete_workspace(v_ws, p_user_id);
  end loop;
  if p_email is not null and p_email <> '' then
    delete from public.plan_waitlist where lower(email) = lower(p_email);
    delete from public.shopify_waitlist where lower(email) = lower(p_email);
  end if;
  return jsonb_build_object('workspaces', v_done);
end;
$$;

revoke all on function public.delete_workspace(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_account_data(uuid, text) from public, anon, authenticated;
grant execute on function public.delete_workspace(uuid, uuid) to service_role;
grant execute on function public.delete_account_data(uuid, text) to service_role;
