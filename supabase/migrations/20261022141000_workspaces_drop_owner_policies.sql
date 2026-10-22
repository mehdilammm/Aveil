-- v0.9 workspaces, step 2: turn off the old owner-only policies (they were OR-ed with the member policies, so a
-- store's creator could still insert into or move a store to any workspace through the API). Applied as
-- ALTER POLICY ... false because DROP POLICY needs an interactive confirmation the migration tool cannot get; the
-- effect is the same. To remove them for good later (SQL editor):
--   drop policy "owner reads stores" on public.stores; ... (same names as below)
alter policy "owner reads stores" on public.stores using (false);
alter policy "owner adds stores" on public.stores with check (false);
alter policy "owner edits stores" on public.stores using (false) with check (false);
alter policy "owner removes stores" on public.stores using (false);
alter policy "owner reads scans" on public.scans using (false);
alter policy "owner reads findings" on public.findings using (false);
alter policy "owner reads traffic" on public.traffic_daily using (false);
alter policy "owner reads runs" on public.visibility_runs using (false);
alter policy "owner reads results" on public.visibility_results using (false);
alter policy "owner reads prompts" on public.visibility_prompts using (false);
alter policy "owner adds prompts" on public.visibility_prompts with check (false);
alter policy "owner removes prompts" on public.visibility_prompts using (false);
