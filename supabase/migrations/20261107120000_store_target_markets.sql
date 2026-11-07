-- Target markets: the countries a store wants to sell to (null = follow WooCommerce's Selling location(s)).
-- Written only by the server (owner or admin, /api/stores/[id]/target-markets); users keep their column grants.
alter table public.stores
  add column if not exists target_markets text[]
  constraint stores_target_markets_valid check (
    target_markets is null
    or (cardinality(target_markets) between 1 and 6 and target_markets <@ array['US', 'UK', 'FR', 'SA', 'AE', 'MA']::text[])
  );

comment on column public.stores.target_markets is
  'Markets the store sells to by choice (US, UK, FR, SA, AE, MA). Null: WooCommerce Selling location(s). Checkout blockers outside them are information (low), not critical.';
