-- First AI order (applied by the owner from Claude chat, 2026-10-30): store_alerts can hold one "first_ai_order" alert per store (the server writes it
-- when the first AI-referred order is synced). Constraint change only: no row changes, no new grants.
alter table public.store_alerts drop constraint store_alerts_kind_check;
alter table public.store_alerts add constraint store_alerts_kind_check check (kind in ('breakage', 'product_check', 'fix_reapplied', 'fix_lost', 'fix_rolled_back', 'first_ai_order'));
