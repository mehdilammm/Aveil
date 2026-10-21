-- v0.2: findings can be "unavailable" (the API key could not read the data),
-- store-level findings carry a fix link, and stores keep the last connection error.
alter table public.findings drop constraint findings_basis_check;
alter table public.findings add constraint findings_basis_check
  check (basis in ('observed', 'heuristic', 'unavailable'));

alter table public.findings add column fix_url text
  check (fix_url is null or fix_url ~* '^https://');

alter table public.stores add column connection_error text
  check (connection_error is null or char_length(connection_error) <= 500);
