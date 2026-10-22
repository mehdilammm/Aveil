# Execution plan

Status: **Done** (in production, tested), **Partial** (some parts exist), **Missing**.
Every milestone ends with the verification gate (tsc, lint, unit tests, matha.site integration test, security
review, plugin performance and escaping checks, no `TODO`/`mock`/`dummy`/`placeholder` or hardcoded UI strings in
new code, this file updated, commit + push).

## Milestone A — Do agents buy? If not, why?

| # | Ticket | Status | What exists | Acceptance criteria |
| --- | --- | --- | --- | --- |
| A1 | AI-referred orders (WooCommerce) | Partial | Parser, config list, sync, table design on branch `claude/agentscope-v0-1-setup-6cez8h` (not applied, not tested). Verified on matha.site's WooCommerce source that attribution meta is `_wc_order_attribution_{source_type,utm_source,referrer,session_entry}` and that `include_meta` filters REST `meta_data` | Last 90 days read with `_fields` limited to id/date/total/currency/status/created_via/meta_data and `include_meta` = attribution keys only; signatures in config; `Unavailable` + how to enable when no order has attribution; stored columns = order id, date, total, currency, source, matched-by, landing path; no PII column exists; UI says many AI visits lose their referrer so the count is a minimum; matha.site (0 orders) shows "No AI-referred orders yet" |
| A2 | Plugin attribution fallback | Missing | — | AI referral (referrer host or utm_source in config) captured once per session into the WC session; written to order meta on `woocommerce_checkout_order_processed` and `woocommerce_store_api_checkout_order_processed` (block checkout); HPOS compatibility declared; consent: without a consent signal (WP Consent API if present) only aggregate counts; no blocking calls; PHP harness tests |
| A3 | Agent checkout | Partial | Matcher on `created_via` (on branch). WooCommerce core removed its Agentic Checkout API in 11.2 (seen in matha.site's WooCommerce source), so no core marker exists | Counted only with evidence on the order; otherwise "Not measurable yet" |
| A4 | AI Revenue funnel page | Partial | Page + `buildFunnel` (on branch) | 6 stages, each with real numbers and a badge (Observed / Heuristic / Unavailable + reason); no estimate anywhere |
| A5 | Why agents aren't buying | Partial | `diagnose()` + checkout rules: guest checkout off, captcha on checkout, no shipping method, sells everywhere but ships to some, no payment / offline only (info), out of stock, checkout blocked for GPTBot (on branch). Price / variation price rules already exist in the scan | First broken stage + reasons with evidence, fix and Fix Center link; heuristic rules labeled; "This does not guarantee sales"; one unit test per rule; matha.site shows "COD only" (info) and "sells to all countries, ships only to MA" |
| A6 | Plans | Partial | `plans.ts` flag `aiRevenue`, migration adds `workspaces.plan` (on branch) | Free = funnel without orders, Pro/Agency = orders + revenue; /pricing updated; plan read server-side |

## Milestone B — Data foundation

| # | Ticket | Status | Notes / acceptance |
| --- | --- | --- | --- |
| B0 | One hardened fetcher | Partial | `PublicFetcher` is hardened; `woo.ts` is not (S1). Accept: all external fetches go through `lib/safe-fetch.ts`; tests for 127.0.0.1, 10/8, 169.254.169.254, ::1, fc00::/7, IPv4-mapped IPv6, redirect to private, size and redirect limits |
| B1 | `StorePlatformAdapter` + contract tests, WooCommerce behind it | Missing | Behaviour unchanged (existing tests stay green) |
| B2 | WooCommerce adapter complete, HPOS declared, updater off the page-load path | Partial | Products, variations, categories, pages, settings exist; attributes and policies via adapter missing |
| B3 | Schema source and `@id` per product page | Missing | Detects WooCommerce core, Yoast, Rank Math, theme; fixes extend the graph |
| B4 | Store-wide access checks: add Claude-SearchBot, Claude-User, Google-Extended | Partial | Public check covers 5 bots; robots verdicts include Google-Extended; access test lacks Claude-SearchBot, Claude-User |
| B5 | Bot verification (IP/CIDR + async rDNS) | Missing | Plugin buffers matching hits on `shutdown`, flushes in batches by WP-Cron; IP + full UA + URL stored only for AI-bot UAs; server verifies against cached official lists; Verified = Observed, UA-only = Heuristic; retention default 90 days; burst detection kept; /privacy + readme updated |
| B6 | Per-scan cost logging + daily cost cap per tenant | Partial | Tokens/requests logged on visibility runs and public reports; no per-scan table, no per-tenant cap (S3) |
| B7 | i18n skeleton (`next-intl`, en + ar, RTL) | Missing | `dir="rtl"` for ar, logical CSS properties, new/touched strings in catalogs |
| B8 | Smart sampling (Free 5/5, Pro 50/25) | Missing | Today: all products for rules, 2 pages for access/JSON-LD |
| B9 | Background jobs | Missing | Section 4 of ARCHITECTURE.md |

## Milestone C — Causal core

| # | Ticket | Status | Notes |
| --- | --- | --- | --- |
| C1 | Native buyer-intent prompts per market/language, full provenance | Partial | Suggestions from products in en/fr/ar exist; no market field, no per-answer country/language/access-method columns; "Ungrounded model answer" label to add |
| C2 | Product Impact summary | Missing | |
| C3 | Competitor gap analyzer | Missing | Disabled until a grounded engine is approved: shows `Unavailable: needs grounded engine` |
| C4 | Prioritized fix queue `(Impact × Confidence) / Effort` | Missing | Fix Center sorts by severity and basis today |

## Milestone D — Fix engine + verify

| # | Ticket | Status | Notes |
| --- | --- | --- | --- |
| D1 | robots.txt patch, WAF guidance, llms.txt generator | Missing | Guidance text exists in findings |
| D2 | Per-product JSON-LD via plugin from signed payloads | Missing | `JSON_HEX_TAG | JSON_HEX_AMP`, `</script>` test |
| D3 | Factual description optimizer with diff + approval | Missing | |
| D4 | Export + opt-in apply (write key), audit log, 1-click undo | Partial | Findings CSV export exists; no apply/undo |
| D5 | Verify loop (immediate technical re-check; visibility at 7/14/30 days) | Partial | Rescan marks findings resolved; no targeted re-fetch, no scheduled visibility re-checks |

## Milestone E — Later (accounts or approval needed)

Shopify app, Turnstile, paid grounded engines, Revenue at Risk, full Arabic release: **Missing**, blocked on accounts
or budget approval.

## Proposed migrations (to approve)

```sql
-- A
alter table public.workspaces add column plan text not null default 'free' check (plan in ('free','pro','agency'));
create table public.ai_orders (store_id, owner_id, order_id bigint, ordered_at, total numeric(14,2), currency,
  source, via check in ('utm_source','referrer','session_entry','plugin'), entry_path, agent_checkout bool,
  unique (store_id, order_id));                       -- RLS: members read (private.store_role), server writes
create table public.order_syncs (store_id pk, synced_at, status ok|unavailable|error, reason, orders_scanned,
  with_attribution, ai_orders, agent_checkouts);      -- RLS: members read
-- B
create table public.jobs (...);  create table public.job_steps (...);        -- service role only
create function public.claim_job(p_worker text) returns setof jobs ...       -- SKIP LOCKED, service role only
create table public.bot_hits (store_id, seen_at, bot, ip inet, user_agent text, url_path text, verified bool,
  method text, ...);                                   -- members read; retention purge job
create table public.bot_ip_ranges (provider, cidr cidr, fetched_at);         -- service role only
create table public.usage_events (workspace_id, store_id, job_id, provider, model, requests, input_tokens,
  output_tokens, cost_usd_micros, created_at);         -- members read own workspace
create table public.store_verifications (store_id, method, token_hash, verified_at, expires_at);
alter table public.visibility_results add column access_method text, add column country text, add column language text;
```

Each migration: RLS on, security definer functions with `set search_path = ''`, grants to `service_role` only where
needed, Supabase security advisor run after applying.
