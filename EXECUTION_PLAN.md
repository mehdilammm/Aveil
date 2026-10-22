# Execution plan

Status: **Done** (in production, tested), **Partial** (some parts exist), **Missing**.
Every milestone ends with the verification gate (tsc, lint, unit tests, matha.site integration test, security
review, plugin performance and escaping checks, no `TODO`/`mock`/`dummy`/`placeholder` or hardcoded UI strings in
new code, this file updated, commit + push).

## Milestone A — Do agents buy? If not, why?

| # | Ticket | Status | What exists | Acceptance criteria |
| --- | --- | --- | --- | --- |
| A1 | AI-referred orders (WooCommerce) | Built (2026-10-23) | `lib/ai-orders.ts`, `lib/orders-sync.ts`, `fetchRecentOrders` (90 days, `_fields` id/date/total/currency/status/created_via/meta_data, `include_meta` = attribution + plugin keys only). Tables `ai_orders`, `order_syncs` applied (no PII column). Unit tests + matha.site real-data test (same query on the live API: 200, 0 orders → "No AI-referred orders yet"). The count is shown as a minimum. Runs from the Pro scan and the `orders_sync` job | as before |
| A2 | Plugin attribution fallback | Built (plugin 1.4.0) | `class-agsc-attribution.php`: opt-in setting `order_attribution` (off by default), session capture on front-end GET, meta `_agsc_ai_referral_{source,via,entry}` on classic and Store API checkout, HPOS + block checkout compatibility declared, WP Consent API `statistics` respected, no network call. PHP harness tests (`lib/plugin-attribution.test.ts`). Not yet installed on matha.site | as before |
| A3 | Agent checkout | Built | Counted only from evidence on the order (`created_via` matcher); otherwise "Not measurable yet" (WooCommerce 11.2 removed its Agentic Checkout API) | as before |
| A4 | AI Revenue funnel page | Built | `/stores/[id]/revenue`: 6 stages, each with its number and a badge (Observed / Heuristic / Unavailable + reason). `lib/funnel.test.ts` | as before |
| A5 | Why agents aren't buying | Built | `diagnose()` + `lib/checkout.ts` rules (one test each). matha.site real data: guest checkout on, sells to all countries / ships only MA (`shipping_gap`), COD only (`offline_payment_only`, heuristic, info), 13 products none out of stock | as before |
| A6 | Plans | Built | `workspaces.plan` applied; plan read server-side. **Test override: the matha.site workspace ("Personal", cd674fa4-…) is set to `pro` by hand for testing. It is not a paid plan; set it back to `free` before launch.** | as before |

## Milestone B — Data foundation

| # | Ticket | Status | Notes / acceptance |
| --- | --- | --- | --- |
| B0 | One hardened fetcher | Done (2026-10-23) | `lib/safe-fetch.ts`: connect-time DNS check used by `woo.ts` (WooCommerce API, page fetches) and `PublicFetcher` (/check); `lib/safe-fetch.test.ts` proves a private IP at connect time is refused. Gemini/Groq/NVIDIA/Mistral calls go to fixed vendor hosts. Accept: all external fetches go through `lib/safe-fetch.ts`; tests for 127.0.0.1, 10/8, 169.254.169.254, ::1, fc00::/7, IPv4-mapped IPv6, redirect to private, size and redirect limits |
| B1 | `StorePlatformAdapter` + contract tests, WooCommerce behind it | Missing | Behaviour unchanged (existing tests stay green) |
| B2 | WooCommerce adapter complete, HPOS declared, updater off the page-load path | Partial | Products, variations, categories, pages, settings exist; attributes and policies via adapter missing |
| B3 | Schema source and `@id` per product page | Missing | Detects WooCommerce core, Yoast, Rank Math, theme; fixes extend the graph |
| B4 | Store-wide access checks: add Claude-SearchBot, Claude-User, Google-Extended | Done (2026-10-23) | Access test sends 12 requests (6 bots × 2 pages) incl. Claude-SearchBot and Claude-User; robots verdicts include Google-Extended |
| B5 | Bot verification (IP/CIDR + async rDNS) | Missing | Plugin buffers matching hits on `shutdown`, flushes in batches by WP-Cron; IP + full UA + URL stored only for AI-bot UAs; server verifies against cached official lists; Verified = Observed, UA-only = Heuristic; retention default 90 days; burst detection kept; /privacy + readme updated |
| B6 | Per-scan cost logging + daily cost cap per tenant | Partial | `usage_events` + daily request caps per workspace and provider (`lib/usage.ts`, 80% warning and "reached" alert on the Visibility page; run stops at the cap). Per-scan logging for the store scan still missing. Prices are 0 (free tiers) |
| B7 | i18n skeleton (`next-intl`, en + ar, RTL) | Missing | `dir="rtl"` for ar, logical CSS properties, new/touched strings in catalogs |
| B8 | Smart sampling (Free 5/5, Pro 50/25) | Missing | Today: all products for rules, 2 pages for access/JSON-LD |
| B9 | Background jobs | Partial | `jobs`, `job_steps`, `claim_job` (SKIP LOCKED), backoff, max attempts; `/api/jobs/tick` answers 404 without the secret header (secret only in Vault); idle tick does no work. First handler: `orders_sync`. pg_cron + pg_net call it every minute (secret read from Vault at run time). Checked in production 2026-10-22: wrong secret → 404; idle tick → 200 `{ran:0}`; queued `orders_sync` for matha.site → succeeded on the next tick, `order_syncs` = ok, 0 orders scanned |

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

## Plugin 1.4.0

Update check moved to a daily WP-Cron event (no network call on admin or visitor pages; filters read the cached
answer only). "Connect" and "Send now" queue a one-off WP-Cron send instead of waiting on the network. Attribution
fallback (A2). Harness test asserts zero network calls before the cron runs.

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
