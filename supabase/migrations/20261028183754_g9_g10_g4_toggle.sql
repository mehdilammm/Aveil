-- G9 / G10 / G4 (applied by the user from Claude chat, 2026-10-28): self-healing and auto-rollback of our own fixes, and the image alt text opt-in.
-- fix_audit_log: 'reapplied' rows record a plugin fix put back after it disappeared (reapplied_of = the original
-- row); revert_reason says why a fix was undone without a person (a new breakage problem pointing to it).
-- store_alerts: the merchant is told when a fix is put back, lost again, or rolled back.
-- stores.alt_text_enabled: G4 fills empty image alt text only after the merchant turns it on (server writes only).
-- Additive only: no row changes, no new grants.
alter table public.fix_audit_log drop constraint fix_audit_log_status_check;
alter table public.fix_audit_log add constraint fix_audit_log_status_check check (status in ('applied', 'reverted', 'failed', 'reapplied'));
alter table public.fix_audit_log add column reapplied_of uuid references public.fix_audit_log(id) on delete set null;
alter table public.fix_audit_log add column revert_reason text check (revert_reason is null or char_length(revert_reason) <= 500);
create index fix_audit_log_reapplied_of_idx on public.fix_audit_log(reapplied_of);

alter table public.store_alerts drop constraint store_alerts_kind_check;
alter table public.store_alerts add constraint store_alerts_kind_check check (kind in ('breakage', 'product_check', 'fix_reapplied', 'fix_lost', 'fix_rolled_back'));

alter table public.stores add column alt_text_enabled boolean not null default false;
alter table public.stores add column alt_text_approved_at timestamptz;
alter table public.stores add column alt_text_approved_by uuid references auth.users(id) on delete set null;
create index stores_alt_text_approved_by_idx on public.stores(alt_text_approved_by);
