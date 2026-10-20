-- Saves (or replaces) the credentials of one store. Server only (service role).
create or replace function public.save_store_credentials(
  p_store_id uuid,
  p_owner_id uuid,
  p_consumer_key text,
  p_consumer_secret text,
  p_key_hint text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key_id uuid;
  v_secret_id uuid;
  v_old public.store_credentials%rowtype;
begin
  if not exists (select 1 from public.stores where id = p_store_id and owner_id = p_owner_id) then
    raise exception 'store not found for owner' using errcode = 'P0002';
  end if;

  select * into v_old from public.store_credentials where store_id = p_store_id for update;

  v_key_id := vault.create_secret(p_consumer_key, null, 'WooCommerce consumer key for store ' || p_store_id);
  v_secret_id := vault.create_secret(p_consumer_secret, null, 'WooCommerce consumer secret for store ' || p_store_id);

  insert into public.store_credentials (store_id, owner_id, consumer_key_secret_id, consumer_secret_secret_id, key_hint)
  values (p_store_id, p_owner_id, v_key_id, v_secret_id, p_key_hint)
  on conflict (store_id) do update
    set consumer_key_secret_id = excluded.consumer_key_secret_id,
        consumer_secret_secret_id = excluded.consumer_secret_secret_id,
        key_hint = excluded.key_hint,
        updated_at = now();

  if v_old.store_id is not null then
    delete from vault.secrets where id in (v_old.consumer_key_secret_id, v_old.consumer_secret_secret_id);
  end if;
end;
$$;

-- Returns the decrypted credentials of one store. Server only (service role).
create or replace function public.get_store_credentials(p_store_id uuid, p_owner_id uuid)
returns table (consumer_key text, consumer_secret text)
language sql
stable
security definer
set search_path = ''
as $$
  select k.decrypted_secret, s.decrypted_secret
  from public.store_credentials c
  join vault.decrypted_secrets k on k.id = c.consumer_key_secret_id
  join vault.decrypted_secrets s on s.id = c.consumer_secret_secret_id
  where c.store_id = p_store_id and c.owner_id = p_owner_id;
$$;

-- Removes the Vault secrets when a credentials row is deleted (including by store cascade).
create or replace function public.delete_store_credential_secrets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id in (old.consumer_key_secret_id, old.consumer_secret_secret_id);
  return old;
end;
$$;

create trigger store_credentials_delete_secrets
  after delete on public.store_credentials
  for each row execute function public.delete_store_credential_secrets();

-- Lets /api/health check that the service role key works and Vault is available.
create or replace function public.agentscope_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'database', true,
    'vault', exists (select 1 from pg_catalog.pg_extension where extname = 'supabase_vault')
  );
$$;

revoke all on function public.save_store_credentials(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.get_store_credentials(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_store_credential_secrets() from public, anon, authenticated;
revoke all on function public.agentscope_health() from public, anon, authenticated;
grant execute on function public.save_store_credentials(uuid, uuid, text, text, text) to service_role;
grant execute on function public.get_store_credentials(uuid, uuid) to service_role;
grant execute on function public.agentscope_health() to service_role;
