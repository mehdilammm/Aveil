-- Defense in depth for service-only tables: RLS with no policy already returns no rows to signed-in users; this
-- also removes the table privilege, like store_credentials and traffic_connectors. The server uses the service role.
revoke all on table public.store_write_credentials from anon, authenticated;
revoke all on table public.workspace_invites from anon, authenticated;
revoke all on table public.job_steps from anon, authenticated;
revoke all on table public.bot_ip_ranges from anon, authenticated;
