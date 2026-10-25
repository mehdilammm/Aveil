-- High 1: users may only set basic columns when adding a store (no auto-fix approval, no status).
revoke insert on public.stores from authenticated, anon;
grant insert (name, url, owner_id, workspace_id) on public.stores to authenticated;

-- High 2: the store URL can no longer change from the browser (it would redirect the read key).
revoke update on public.stores from authenticated, anon;
grant update (name, bot_hit_retention_days) on public.stores to authenticated;
