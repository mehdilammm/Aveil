-- v0.9 workspaces, step 2: remove the old owner-only policies. Until then a store's creator keeps access to it
-- even if removed from its workspace (the policies are OR-ed). The member policies from step 1 replace them.
drop policy "owner reads stores" on public.stores;
drop policy "owner adds stores" on public.stores;
drop policy "owner edits stores" on public.stores;
drop policy "owner removes stores" on public.stores;
drop policy "owner reads scans" on public.scans;
drop policy "owner reads findings" on public.findings;
drop policy "owner reads traffic" on public.traffic_daily;
drop policy "owner reads runs" on public.visibility_runs;
drop policy "owner reads results" on public.visibility_results;
drop policy "owner reads prompts" on public.visibility_prompts;
drop policy "owner adds prompts" on public.visibility_prompts;
drop policy "owner removes prompts" on public.visibility_prompts;
