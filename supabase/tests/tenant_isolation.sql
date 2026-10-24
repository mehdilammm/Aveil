-- Tenant isolation check against the real database. Run each block in the Supabase SQL editor (or through the
-- SQL tool): it switches to the "authenticated" role inside a transaction that is never committed.
-- Last run in production: 2026-10-24, all checks passed (see EXECUTION_PLAN.md, G2).

-- 1. A signed-in user who belongs to no workspace sees 0 rows in every member table.
begin;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000999', 'role', 'authenticated')::text, true);
set local role authenticated;
select json_build_object(
  'stores', (select count(*) from public.stores), 'scans', (select count(*) from public.scans), 'findings', (select count(*) from public.findings),
  'workspaces', (select count(*) from public.workspaces), 'workspace_members', (select count(*) from public.workspace_members),
  'traffic_daily', (select count(*) from public.traffic_daily), 'visibility_prompts', (select count(*) from public.visibility_prompts),
  'visibility_runs', (select count(*) from public.visibility_runs), 'visibility_results', (select count(*) from public.visibility_results),
  'ai_orders', (select count(*) from public.ai_orders), 'order_syncs', (select count(*) from public.order_syncs), 'bot_hits', (select count(*) from public.bot_hits),
  'jobs', (select count(*) from public.jobs), 'usage_events', (select count(*) from public.usage_events), 'scan_schema_pages', (select count(*) from public.scan_schema_pages),
  'store_verifications', (select count(*) from public.store_verifications), 'finding_verifications', (select count(*) from public.finding_verifications),
  'visibility_rechecks', (select count(*) from public.visibility_rechecks), 'description_drafts', (select count(*) from public.description_drafts),
  'fix_audit_log', (select count(*) from public.fix_audit_log)) as stranger_rows; -- expected: all 0
rollback;

-- 2. That user cannot add rows to another tenant's store (expected: "new row violates row-level security policy").
begin;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000999', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.visibility_prompts (store_id, owner_id, prompt) select id, '00000000-0000-4000-8000-000000000999', 'isolation test' from public.stores limit 1;
rollback;

-- 3. Service-only tables and functions are not even granted to signed-in users (expected: all false).
select json_build_object(
  'store_credentials', has_table_privilege('authenticated', 'public.store_credentials', 'select'),
  'store_write_credentials', has_table_privilege('authenticated', 'public.store_write_credentials', 'select'),
  'traffic_connectors', has_table_privilege('authenticated', 'public.traffic_connectors', 'select'),
  'workspace_invites', has_table_privilege('authenticated', 'public.workspace_invites', 'select'),
  'job_steps', has_table_privilege('authenticated', 'public.job_steps', 'select'),
  'bot_ip_ranges', has_table_privilege('authenticated', 'public.bot_ip_ranges', 'select'),
  'public_reports', has_table_privilege('authenticated', 'public.public_reports', 'select'),
  'get_store_credentials', has_function_privilege('authenticated', 'public.get_store_credentials(uuid,uuid)', 'execute'),
  'get_store_write_credentials', has_function_privilege('authenticated', 'public.get_store_write_credentials(uuid,uuid)', 'execute'),
  'claim_job', has_function_privilege('authenticated', 'public.claim_job(integer)', 'execute')) as service_only_grants;

-- 4. A member sees only stores of workspaces they belong to (replace the sub with a member's user id).
begin;
select set_config('request.jwt.claims', json_build_object('sub', 'MEMBER_USER_ID', 'role', 'authenticated')::text, true);
set local role authenticated;
select count(*) as visible_outside_membership from public.stores s
where not exists (select 1 from public.workspace_members m where m.workspace_id = s.workspace_id and m.user_id = 'MEMBER_USER_ID'); -- expected: 0
rollback;
