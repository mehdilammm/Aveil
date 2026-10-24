-- Hard delete test (G1 fix). Run in one transaction that is rolled back, so nothing real changes:
-- builds a workspace with a store, its three kinds of Vault secrets and a row in every kind of child table,
-- runs public.delete_workspace(), then checks that no row with that workspace_id or store_id and no secret is
-- left, and that a non-owner is refused. Expected output: one row, every count 0, refused = true.
begin;
create temp table t_ids as select gen_random_uuid() ws, gen_random_uuid() store, 'd402b434-591f-40d7-b7f5-326a456d301e'::uuid owner;

insert into public.workspaces (id, name, personal, created_by) select ws, 'delete test', false, owner from t_ids;
insert into public.workspace_members (workspace_id, user_id, role) select ws, owner, 'owner' from t_ids;
insert into public.workspace_invites (workspace_id, role, token_hash, created_by, expires_at) select ws, 'viewer', md5(random()::text), owner, now() + interval '1 day' from t_ids;
insert into public.stores (id, name, url, owner_id, workspace_id) select store, 'Delete test', 'https://delete-test.example', owner, ws from t_ids;
select public.save_store_credentials(store, owner, 'ck_test0000000000000000000000', 'cs_test0000000000000000000000', 'ck_…0000') from t_ids;
select public.save_store_write_credentials(store, owner, 'ck_test1111111111111111111111', 'cs_test1111111111111111111111', 'ck_…1111') from t_ids;
select public.save_traffic_connector(store, owner, 'agsc_test', encode(sha256('agsc_test'::bytea), 'hex'), 'agsc_…test') from t_ids;
insert into public.scans (id, store_id, owner_id, status) select gen_random_uuid(), store, owner, 'complete' from t_ids;
insert into public.findings (scan_id, store_id, owner_id, finding_key, type, title, severity, evidence, guidance, basis)
  select s.id, i.store, i.owner, 'k', 't', 'T', 'low', 'e', 'g', 'observed' from t_ids i join public.scans s on s.store_id = i.store;
insert into public.jobs (workspace_id, store_id, kind) select ws, store, 'scan' from t_ids;
insert into public.usage_events (workspace_id, store_id, kind, provider) select ws, store, 'test', 'gemini' from t_ids;

create temp table t_secrets as
  select unnest(array[consumer_key_secret_id, consumer_secret_secret_id]) id from public.store_credentials where store_id = (select store from t_ids)
  union all select unnest(array[consumer_key_secret_id, consumer_secret_secret_id]) from public.store_write_credentials where store_id = (select store from t_ids)
  union all select secret_id from public.traffic_connectors where store_id = (select store from t_ids);

-- A user who is not the owner is refused, and nothing is deleted.
do $$ begin
  perform public.delete_workspace((select ws from t_ids), gen_random_uuid());
  raise exception 'non-owner was not refused';
exception when insufficient_privilege then null;
end $$;

select public.delete_workspace(ws, owner) from t_ids;

select
  (select count(*) from t_secrets) secrets_made,
  (select count(*) from vault.secrets where id in (select id from t_secrets)) secrets_left,
  (select count(*) from public.workspaces where id = (select ws from t_ids)) workspaces_left,
  (select count(*) from public.workspace_members where workspace_id = (select ws from t_ids)) members_left,
  (select count(*) from public.workspace_invites where workspace_id = (select ws from t_ids)) invites_left,
  (select count(*) from public.stores where id = (select store from t_ids)) stores_left,
  (select count(*) from public.jobs where workspace_id = (select ws from t_ids)) jobs_left,
  (select count(*) from public.usage_events where workspace_id = (select ws from t_ids)) usage_left,
  (select count(*) from public.findings where store_id = (select store from t_ids)) findings_left;
rollback;
