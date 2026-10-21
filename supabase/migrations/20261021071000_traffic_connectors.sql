-- Traffic plugin connections. The signing token lives in Vault (HMAC needs the server to know it);
-- token_hash (SHA-256) identifies it without decrypting. Server only: RLS on, no policies, no grants.
create table public.traffic_connectors (
  store_id uuid primary key references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  secret_id uuid not null,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint text not null check (char_length(token_hint) <= 16),
  created_at timestamptz not null default now(),
  last_ingest_at timestamptz,
  window_start timestamptz,
  window_count integer not null default 0
);

alter table public.traffic_connectors enable row level security;
revoke all on table public.traffic_connectors from anon, authenticated;
create index traffic_connectors_owner_id_idx on public.traffic_connectors(owner_id);

-- Creates or replaces the connector of one store.
create or replace function public.save_traffic_connector(p_store_id uuid, p_owner_id uuid, p_token text, p_token_hash text, p_hint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_old_secret uuid;
begin
  if not exists (select 1 from public.stores where id = p_store_id and owner_id = p_owner_id) then
    raise exception 'store not found for owner' using errcode = 'P0002';
  end if;
  select secret_id into v_old_secret from public.traffic_connectors where store_id = p_store_id for update;
  v_secret_id := vault.create_secret(p_token, null, 'AgentScope traffic token for store ' || p_store_id);
  insert into public.traffic_connectors (store_id, owner_id, secret_id, token_hash, token_hint)
  values (p_store_id, p_owner_id, v_secret_id, p_token_hash, p_hint)
  on conflict (store_id) do update
    set secret_id = excluded.secret_id, token_hash = excluded.token_hash, token_hint = excluded.token_hint,
        created_at = now(), last_ingest_at = null, window_start = null, window_count = 0;
  if v_old_secret is not null then
    delete from vault.secrets where id = v_old_secret;
  end if;
end;
$$;

-- Returns the signing token and owner of a store's connector.
create or replace function public.get_traffic_connector_secret(p_store_id uuid)
returns table (owner_id uuid, token text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.owner_id, s.decrypted_secret
  from public.traffic_connectors c
  join vault.decrypted_secrets s on s.id = c.secret_id
  where c.store_id = p_store_id;
$$;

-- Counts one ingest request; false when the store is over p_limit requests in the current window.
create or replace function public.traffic_rate_check(p_store_id uuid, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.traffic_connectors
     set window_start = case when window_start is null or window_start < now() - make_interval(secs => p_window_seconds) then now() else window_start end,
         window_count = case when window_start is null or window_start < now() - make_interval(secs => p_window_seconds) then 1 else window_count + 1 end
   where store_id = p_store_id
  returning window_count into v_count;
  return v_count is not null and v_count <= p_limit;
end;
$$;

create or replace function public.delete_traffic_connector_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end;
$$;

create trigger traffic_connectors_delete_secret
  after delete on public.traffic_connectors
  for each row execute function public.delete_traffic_connector_secret();

revoke all on function public.save_traffic_connector(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.get_traffic_connector_secret(uuid) from public, anon, authenticated;
revoke all on function public.traffic_rate_check(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.delete_traffic_connector_secret() from public, anon, authenticated;
grant execute on function public.save_traffic_connector(uuid, uuid, text, text, text) to service_role;
grant execute on function public.get_traffic_connector_secret(uuid) to service_role;
grant execute on function public.traffic_rate_check(uuid, integer, integer) to service_role;
