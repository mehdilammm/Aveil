-- L5 (security audit 2026-10-31): deleting an account also deletes the open invites sent to its email and the store
-- deletion records it made. Same function as before otherwise.
create or replace function public.delete_account_data(p_user_id uuid, p_email text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
    delete from public.workspace_invites where lower(email) = lower(p_email) and accepted_at is null;
  end if;
  delete from public.store_deletions where deleted_by = p_user_id;
  return jsonb_build_object('workspaces', v_done);
end;
$function$;
