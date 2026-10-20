-- Move WooCommerce credentials to Supabase Vault. store_credentials keeps only Vault references.
-- The old app-encrypted columns are no longer written; they stay nullable until a later cleanup.
alter table public.store_credentials
  alter column consumer_key_enc drop not null,
  alter column consumer_secret_enc drop not null,
  add column consumer_key_secret_id uuid not null,
  add column consumer_secret_secret_id uuid not null;
