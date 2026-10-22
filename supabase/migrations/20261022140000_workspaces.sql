-- v0.9 Teams and workspaces. A workspace holds stores and members (owner / admin / viewer).
-- Existing stores move into a personal workspace of their owner. The old owner-only policies are removed in the
-- next migration (20261022141000), which needs a confirmation because it drops policies. Members read everything of the workspace's stores;
-- owners and admins change things; viewers only read. Keys, tokens and invites stay server-only.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  personal boolean not null default false,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index workspaces_created_by_idx on public.workspaces(created_by);
create unique index workspaces_one_personal_idx on public.workspaces(created_by) where personal;

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id);

-- Invite links: only a SHA-256 of the token is stored; the link is shown once. Optional email must match on accept.
create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role text not null check (role in ('admin', 'viewer')),
  email text check (email is null or char_length(email) <= 254),
  token_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index workspace_invites_workspace_idx on public.workspace_invites(workspace_id);
create index workspace_invites_created_by_idx on public.workspace_invites(created_by);
create index workspace_invites_accepted_by_idx on public.workspace_invites(accepted_by);

-- Personal workspace for every store owner, and the stores in it.
insert into public.workspaces (name, personal, created_by)
select 'Personal', true, owner_id from (select distinct owner_id from public.stores) o;
insert into public.workspace_members (workspace_id, user_id, role)
select w.id, w.created_by, 'owner' from public.workspaces w where w.personal;

alter table public.stores add column workspace_id uuid references public.workspaces(id) on delete cascade;
update public.stores s set workspace_id = w.id from public.workspaces w where w.personal and w.created_by = s.owner_id;
alter table public.stores alter column workspace_id set not null;
create index stores_workspace_idx on public.stores(workspace_id);

-- Role helpers in a schema the API does not expose. Security definer so policies can read memberships without
-- recursing into the members table's own policy. They only answer about the calling user.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.ws_role(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = (select auth.uid());
$$;

create or replace function private.store_role(p_store_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.stores s join public.workspace_members m on m.workspace_id = s.workspace_id
  where s.id = p_store_id and m.user_id = (select auth.uid());
$$;

revoke all on function private.ws_role(uuid) from public, anon;
revoke all on function private.store_role(uuid) from public, anon;
grant execute on function private.ws_role(uuid) to authenticated, service_role;
grant execute on function private.store_role(uuid) to authenticated, service_role;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;

create policy "members read workspaces" on public.workspaces for select to authenticated
  using ((select private.ws_role(id)) is not null);
create policy "owner renames workspace" on public.workspaces for update to authenticated
  using ((select private.ws_role(id)) = 'owner') with check ((select private.ws_role(id)) = 'owner');
create policy "members read members" on public.workspace_members for select to authenticated
  using ((select private.ws_role(workspace_id)) is not null);
-- workspace_invites: no policy, server (service role) only. Creating workspaces and members also goes through the server.

-- Stores: members read; owners and admins add, edit and delete.
create policy "members read stores" on public.stores for select to authenticated
  using ((select private.ws_role(workspace_id)) is not null);
create policy "editors add stores" on public.stores for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select private.ws_role(workspace_id)) in ('owner', 'admin'));
create policy "editors edit stores" on public.stores for update to authenticated
  using ((select private.ws_role(workspace_id)) in ('owner', 'admin'))
  with check ((select private.ws_role(workspace_id)) in ('owner', 'admin'));
create policy "editors remove stores" on public.stores for delete to authenticated
  using ((select private.ws_role(workspace_id)) in ('owner', 'admin'));

-- Store data: members read.
create policy "members read scans" on public.scans for select to authenticated using ((select private.store_role(store_id)) is not null);
create policy "members read findings" on public.findings for select to authenticated using ((select private.store_role(store_id)) is not null);
create policy "members read traffic" on public.traffic_daily for select to authenticated using ((select private.store_role(store_id)) is not null);
create policy "members read runs" on public.visibility_runs for select to authenticated using ((select private.store_role(store_id)) is not null);
create policy "members read results" on public.visibility_results for select to authenticated using ((select private.store_role(store_id)) is not null);

-- Questions: members read; owners and admins add and remove.
create policy "members read prompts" on public.visibility_prompts for select to authenticated using ((select private.store_role(store_id)) is not null);
create policy "editors add prompts" on public.visibility_prompts for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select private.store_role(store_id)) in ('owner', 'admin'));
create policy "editors remove prompts" on public.visibility_prompts for delete to authenticated
  using ((select private.store_role(store_id)) in ('owner', 'admin'));
