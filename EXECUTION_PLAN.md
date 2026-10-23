# Execution plan

Status: **Done** (in production, tested), **Partial** (some parts exist), **Missing**.
Every milestone ends with the verification gate (tsc, lint (`npm run lint`: oxlint, because typescript-eslint does not support TypeScript 7 yet), unit tests, matha.site integration test, security
review, plugin performance and escaping checks, no `TODO`/`mock`/`dummy`/`placeholder` or hardcoded UI strings in
new code, this file updated, commit + push).

## Milestone A — Do agents buy? If not, why?

| # | Ticket | Status | What exists | Acceptance criteria |
| --- | --- | --- | --- | --- |
| A1 | AI-referred orders (WooCommerce) | Built (2026-10-23) | `lib/ai-orders.ts`, `lib/orders-sync.ts`, `fetchRecentOrders` (90 days, `_fields` id/date/total/currency/status/created_via/meta_data, `include_meta` = attribution + plugin keys only). Tables `ai_orders`, `order_syncs` applied (no PII column). Unit tests + matha.site real-data test (same query on the live API: 200, 0 orders → "No AI-referred orders yet"). The count is shown as a minimum. Runs from the Pro scan and the `orders_sync` job. Each sync reconciles: counted statuses are processing / completed / on-hold (`COUNTED_STATUSES`); stored orders no longer in the result (cancelled, failed, refunded, trash, deleted) are removed; full refunds are not counted, partial refunds lower net revenue (`ai_orders.refunded`); revenue is recomputed, never accumulated (`lib/orders-sync.test.ts`). Bug found on matha.site 2026-10-22 (cancelled #213 still counted) fixed | as before |
| A2 | Plugin attribution fallback | Built (plugin 1.4.0) | `class-agsc-attribution.php`: opt-in setting `order_attribution` (off by default), session capture on front-end GET, meta `_agsc_ai_referral_{source,via,entry}` on classic and Store API checkout, HPOS + block checkout compatibility declared, WP Consent API `statistics` respected, no network call. PHP harness tests (`lib/plugin-attribution.test.ts`). Not yet installed on matha.site | as before |
| A3 | Agent checkout | Built | Counted only from evidence on the order (`created_via` matcher); otherwise "Not measurable yet" (WooCommerce 11.2 removed its Agentic Checkout API) | as before |
| A4 | AI Revenue funnel page | Built | `/stores/[id]/revenue`: 6 stages, each with its number and a badge (Observed / Heuristic / Unavailable + reason). `lib/funnel.test.ts` | as before |
| A5 | Why agents aren't buying | Built | `diagnose()` + `lib/checkout.ts` rules (one test each). matha.site real data: guest checkout on, sells to all countries / ships only MA (`shipping_gap`), COD only (`offline_payment_only`, heuristic, info), 13 products none out of stock. Fix 2026-10-23: the checkout page check follows the access-test rule (401/403 or a challenge page = blocked, high, observed; 429 = `checkout_rate_limited_bots`, medium, heuristic, after a wait and one retry). It had reported GPTBot's 429 on matha.site as blocked | as before |
| A6 | Plans | Built | `workspaces.plan` applied; plan read server-side. **Test override: the matha.site workspace ("Personal", cd674fa4-…) is set to `pro` by hand for testing. It is not a paid plan; set it back to `free` before launch.** | as before |

## Milestone B — Data foundation

| # | Ticket | Status | Notes / acceptance |
| --- | --- | --- | --- |
| B0 | One hardened fetcher | Done (2026-10-23) | `lib/safe-fetch.ts`: connect-time DNS check used by `woo.ts` (WooCommerce API, page fetches) and `PublicFetcher` (/check); `lib/safe-fetch.test.ts` proves a private IP at connect time is refused. Gemini/Groq/NVIDIA/Mistral calls go to fixed vendor hosts. Accept: all external fetches go through `lib/safe-fetch.ts`; tests for 127.0.0.1, 10/8, 169.254.169.254, ::1, fc00::/7, IPv4-mapped IPv6, redirect to private, size and redirect limits |
| B1 | `StorePlatformAdapter` + contract tests, WooCommerce behind it | Done (2026-10-22) | `lib/platform/adapter.ts` (fetchProducts, fetchVariations, fetchCategories, fetchAttributes, fetchPolicies, fetchCheckoutSetup, fetchProductSchema, checkBotAccess, verifyOwnership, applyFix, revertFix). `lib/platform/woocommerce.ts` wraps the existing calls; `lib/scan.ts` uses it with the same requests and findings. `applyFix`/`revertFix` refuse with the reason until D4 (no write path exists). Contract tests run on matha.site answers (`lib/platform/contract.test.ts`, fixture `matha-catalog-2026-10-22.json`). Ownership: `store_verifications` table; API key verification recorded by each successful scan; DNS TXT / meta tag / `.well-known` file checks in `lib/ownership.ts` (tests). Store page "Ownership" card: current proof, and DNS TXT / meta tag / file tokens with "Check now" (owners and admins) |
| B2 | WooCommerce adapter complete, HPOS declared, updater off the page-load path | Done (2026-10-22) | Products, variations, categories (`fetchCategories`), global attributes with terms (`fetchAttributes`), policies (settings + public pages), checkout setup. HPOS and block checkout compatibility declared in plugin 1.4.0 (installed on matha.site, active). Updater on WP-Cron (1.4.0). `lib/woo-catalog.test.ts` |
| B3 | Schema source and `@id` per product page | Done (2026-10-22) | `lib/schema-source.ts` reads the script tags: Yoast (`yoast-schema-graph`), Rank Math (`rank-math-schema`), WooCommerce core (plain footer script, Product `@id` = permalink + `#product`, checked in WooCommerce 11.2.1 source), else theme / other plugin. Stored per sampled page in `scan_schema_pages` (source, `@id`, duplicate) and shown on the scan page; finding `schema_duplicate_product` when two different Product nodes are on one page. Tests `lib/schema-source.test.ts` |
| B4 | Store-wide access checks: add Claude-SearchBot, Claude-User, Google-Extended | Done (2026-10-23) | Access test sends 12 requests (6 bots × 2 pages) incl. Claude-SearchBot and Claude-User; robots verdicts include Google-Extended |
| B5 | Bot verification (IP/CIDR + async rDNS) | Done in code, released as plugin 1.5.0 (2026-10-23); live check waits for the update on matha.site | Rules approved 2026-10-23: IP stored only for known AI bot user agents, never people. Plugin `class-agsc-bothits.php`: one local INSERT on `shutdown` (no network), signed batches of 500 from WP-Cron every 15 min to `/api/ingest/bot-hits`, rows deleted after a successful send or after 7 days at most, deleted at once on deactivate/uninstall. Server: published lists in `bot_ip_ranges` (7 lists read in production: OpenAI 3, Anthropic, Perplexity 2, Google), job `bot_hits_verify`: IP in list or Google rDNS = verified (Observed); otherwise "user agent only" (Heuristic) and the IP is deleted right after the check (`bot_hits_unverified_no_ip` constraint). Verified IPs kept at most 90 days (`bot_hit_retention_days` 7–90). Traffic page "Bot identity" table, counts as a minimum. /privacy and readme state these rules. Tests: `lib/bot-verify.test.ts`, `lib/bot-hits.test.ts`, `lib/bot-jobs.test.ts`, `lib/plugin-bothits.test.ts` (PHP: only bots, never people, signed batch accepted by the app, delete after send, 7-day limit, no network on page load) |
| B6 | Per-scan cost logging + daily cost cap per tenant | Done (2026-10-22) | Scans: `scans.requests_count` (outbound requests counted per step with AsyncLocalStorage in `safe-fetch.ts`) and `cost_usd_micros` (0: a scan calls no AI service), shown on the scan page. Visibility runs: tokens/requests on `visibility_runs` + `usage_events`; daily caps per workspace with alert (Milestone A) |
| B7 | i18n skeleton (`next-intl`, en + ar, RTL) | Done (skeleton, 2026-10-22) | `next-intl` 4.14.7 without locale routing: language kept in the `NEXT_LOCALE` cookie, switch in the footer and the app sidebar; `<html lang dir>` set from it (`ar` → `rtl`). Catalogs `messages/en.json`, `messages/ar.json`, test that both have the same keys and placeholders. CSS moved to logical properties (no Tailwind in this app). Footer and language switch translated; new strings from here on go to the catalogs. Older pages stay English until the full Arabic release (Milestone E) |
| B8 | Smart sampling (Free 5/5, Pro 50/25) | Done (2026-10-22) | `lib/sampling.ts`: best sellers first (`total_sales`), else one product per category in turn. `PLANS[plan].sampleProducts` (5 / 50) product pages checked one by one for structured data and its source; product rules still run on every product. Questions per plan: 5 / 25 (enforced when adding and when running). Tests on matha.site's catalog |
| B9 | Background jobs | Done (2026-10-22) | `jobs` + `job_steps`, `claim_job` (SKIP LOCKED), backoff, max attempts; step results saved and reused; a job yields between steps when its tick is short (no attempt used); permanent errors (refused key) fail at once. Kinds: `scan` (start → products page by page → store checks → sampled pages by 10 → finish), `visibility`, `orders_sync`. Driven by pg_cron every minute, by `after()` right after a user queues a job, and by the daily Vercel cron. Pages follow the job (`/api/jobs/[id]`, progress text in en/ar). Tests `lib/scan-job.test.ts` (all steps, yield and resume, retried step without duplicates, refused key) |

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
| D1 | robots.txt patch, WAF guidance, llms.txt generator | Done (2026-10-23) | `/stores/[id]/fix/generators` (owners/admins), copy or download, nothing written to the store. robots.txt: the live file with only the AI agents' lines rewritten (`lib/fixes/robots-patch.ts`), search/shopping agents allowed, training crawlers allow/block by the merchant's choice, the "*" closures copied to the AI groups, idempotent, checked with the scan's parser (verdicts as intended, other bots and sitemaps unchanged), WordPress steps (file, Yoast, Rank Math, virtual file). WAF: copy-only steps from the detected vendor and the last scan's blocked / challenged / 429 bots, allow by the official IP lists. llms.txt: from the site title and tagline, public pages, categories with their public links and counts, sampled products with price (`lib/fixes/llms-txt.ts`), nothing invented, missing parts listed. Tests `lib/fixes/*.test.ts` (matha.site catalog) |
| D2 | Per-product JSON-LD via plugin from signed payloads | Missing | `JSON_HEX_TAG | JSON_HEX_AMP`, `</script>` test |
| D3 | Factual description optimizer with diff + approval | Done (2026-10-23) | `/stores/[id]/fix/descriptions`: the product's current text kept as written plus a "Details" list made only of store data (category, attributes, size, weight with the store's units, brand, SKU, GTIN) and the merchant's typed facts (material, use, care, warranty, in the box, other). No model writes text, so nothing can be invented; missing facts are flagged, never filled. Side-by-side line diff, Approve / Discard (`description_drafts`), approved texts copied or exported as a WooCommerce import CSV (ID, Description, formula-safe). Nothing written to the store. Tested on matha.site product 174's real data (units lbs / in, brand Matha Mirrors; size empty in the store, so flagged). Labels in the generated list are English for now |
| D4 | Export + opt-in apply (write key), audit log, 1-click undo | Partial | Findings CSV export exists; no apply/undo |
| D5 | Verify loop (immediate technical re-check; visibility at 7/14/30 days) | Done (2026-10-23) | Fix Center "Verify fix" (owners/admins) queues `verify_finding`: the check that made the finding runs again on just that item (product via API; product page, robots.txt, llms.txt and checkout page fetched with no-cache headers and a unique `agsc_verify` query string), up to 3 times 20 s apart. "Resolved (Observed)" only when the re-check ran and the finding is gone; a page that cannot load, a product no longer published or a refused key is "Unavailable" with the reason (`lib/verify.ts`, `finding_verifications`). A verified fix schedules AI Visibility runs 7, 14 and 30 days later (`visibility_rechecks`, one per store and day), shown as what the models answered on those days, never as proof. Rescans still mark findings resolved. Tests `lib/verify*.test.ts` (matha.site product 173) |

## Plugin 1.4.0

Update check moved to a daily WP-Cron event (no network call on admin or visitor pages; filters read the cached
answer only). "Connect" and "Send now" queue a one-off WP-Cron send instead of waiting on the network. Attribution
fallback (A2). Harness test asserts zero network calls before the cron runs.

## Plugin 1.5.0

AI bot identity (B5), see B5. Released through the update checker (`/api/plugin/latest`), zip SHA-256 in `lib/plugin-release.json`.

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
