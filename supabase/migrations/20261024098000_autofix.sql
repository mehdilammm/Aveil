-- Auto-fix (D2 + D4). Additive only.
-- store_write_credentials: a separate WooCommerce key with Read/Write, in Vault, apart from the read key.
create table public.store_write_credentials (
  store_id uuid primary key references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  consumer_key_secret_id uuid not null,
  consumer_secret_secret_id uuid not null,
  key_hint text not null check (char_length(key_hint) <= 40),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index store_write_credentials_owner_idx on public.store_write_credentials(owner_id);
alter table public.store_write_credentials enable row level security;

create or replace function public.save_store_write_credentials(p_store_id uuid, p_owner_id uuid, p_consumer_key text, p_consumer_secret text, p_key_hint text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_key_id uuid;
  v_secret_id uuid;
  v_old public.store_write_credentials%rowtype;
begin
  if not exists (select 1 from public.stores where id = p_store_id and owner_id = p_owner_id) then
    raise exception 'store not found for owner' using errcode = 'P0002';
  end if;
  select * into v_old from public.store_write_credentials where store_id = p_store_id for update;
  v_key_id := vault.create_secret(p_consumer_key, null, 'WooCommerce WRITE consumer key for store ' || p_store_id);
  v_secret_id := vault.create_secret(p_consumer_secret, null, 'WooCommerce WRITE consumer secret for store ' || p_store_id);
  insert into public.store_write_credentials (store_id, owner_id, consumer_key_secret_id, consumer_secret_secret_id, key_hint, checked_at)
  values (p_store_id, p_owner_id, v_key_id, v_secret_id, p_key_hint, now())
  on conflict (store_id) do update set consumer_key_secret_id = excluded.consumer_key_secret_id, consumer_secret_secret_id = excluded.consumer_secret_secret_id,
    key_hint = excluded.key_hint, checked_at = now(), updated_at = now();
  if v_old.store_id is not null then
    delete from vault.secrets where id in (v_old.consumer_key_secret_id, v_old.consumer_secret_secret_id);
  end if;
end;
$$;

create or replace function public.get_store_write_credentials(p_store_id uuid, p_owner_id uuid)
returns table (consumer_key text, consumer_secret text) language sql stable security definer set search_path = '' as $$
  select k.decrypted_secret, s.decrypted_secret
  from public.store_write_credentials c
  join vault.decrypted_secrets k on k.id = c.consumer_key_secret_id
  join vault.decrypted_secrets s on s.id = c.consumer_secret_secret_id
  where c.store_id = p_store_id and c.owner_id = p_owner_id;
$$;

create or replace function public.delete_store_write_credential_secrets()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where id in (old.consumer_key_secret_id, old.consumer_secret_secret_id);
  return old;
end;
$$;
create trigger store_write_credentials_delete_secrets after delete on public.store_write_credentials
  for each row execute function public.delete_store_write_credential_secrets();

revoke all on function public.save_store_write_credentials(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.get_store_write_credentials(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_store_write_credential_secrets() from public, anon, authenticated;

-- The setting, off by default, and what the merchant approved the first time it was turned on.
alter table public.stores
  add column auto_fix_enabled boolean not null default false,
  add column auto_fix_approved_at timestamptz,
  add column auto_fix_approved_by uuid references auth.users(id) on delete set null,
  add column auto_fix_preview jsonb;

-- FixAuditLog: who, what, when, before, after; undo uses "before".
create table public.fix_audit_log (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null,
  finding_key text not null check (char_length(finding_key) <= 300),
  fix_type text not null check (fix_type in ('auto', 'one_click', 'input')),
  kind text not null check (char_length(kind) <= 40),
  channel text not null check (channel in ('plugin', 'write_key')),
  target text not null check (char_length(target) <= 300),
  before jsonb,
  after jsonb,
  status text not null check (status in ('applied', 'reverted', 'failed')),
  error text check (error is null or char_length(error) <= 500),
  verify_status text check (verify_status is null or verify_status in ('resolved', 'still_open', 'unavailable')),
  verify_evidence text check (verify_evidence is null or char_length(verify_evidence) <= 1000),
  applied_by uuid references auth.users(id) on delete set null,
  automatic boolean not null default false,
  applied_at timestamptz not null default now(),
  reverted_by uuid references auth.users(id) on delete set null,
  reverted_at timestamptz
);
create index fix_audit_log_store_idx on public.fix_audit_log(store_id, applied_at desc);
create index fix_audit_log_owner_idx on public.fix_audit_log(owner_id);
create index fix_audit_log_batch_idx on public.fix_audit_log(batch_id);
create index fix_audit_log_applied_by_idx on public.fix_audit_log(applied_by);
create index fix_audit_log_reverted_by_idx on public.fix_audit_log(reverted_by);
alter table public.fix_audit_log enable row level security;
create policy "members read fix audit log" on public.fix_audit_log for select to authenticated using ((select private.store_role(store_id)) is not null);
