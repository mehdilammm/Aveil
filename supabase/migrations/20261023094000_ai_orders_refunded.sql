-- Refunded amount per AI-referred order: net revenue = total - refunded. Fully refunded orders are not stored.
alter table public.ai_orders add column refunded numeric(14, 2) not null default 0 check (refunded >= 0);
