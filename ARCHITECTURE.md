# AgentScope architecture (audit of 2026-10-23, app v1.0, plugin 1.3.1)

Production: Next.js 16 App Router (TypeScript) on Vercel, Supabase (Postgres + Auth + Vault, project `agentscope`),
WordPress plugin `agentscope-core` (`wordpress/agentscope-core`). Tests: Vitest (`lib/*.test.ts`), PHP code is
exercised from Vitest through the `php` CLI with small harnesses (`lib/fixtures/*-harness.php`).

## 1. Existing modules

| Area | Files | What it does |
| --- | --- | --- |
| Auth, proxy | `proxy.ts`, `lib/supabase/{server,admin}.ts`, `app/login`, `app/auth` | Supabase Auth (email + password), session refresh, public path list, sign-up requires Terms consent |
| Workspaces | `lib/workspace.ts`, `app/settings/workspaces`, `app/invite/[token]` | owner / admin / viewer, invite links (SHA-256 of token stored), `private.ws_role()` / `private.store_role()` used by RLS |
| Stores, credentials | `app/stores/actions.ts`, `store_credentials` + Vault functions | One WooCommerce REST key per store (Read), encrypted in Vault, `get_store_credentials` service-role only |
| Full scan (WooCommerce) | `lib/scan.ts`, `lib/woo.ts`, `lib/rules.ts`, `lib/feed.ts`, `lib/pages.ts`, `lib/agent-checks.ts`, `lib/access.ts`, `lib/robots.ts`, `lib/structured-data.ts`, `lib/gate.ts` | Products + variations rules, ChatGPT feed fields, store/policy pages, bot access (5 AI bots vs browser), robots.txt, llms.txt, JSON-LD on 2 product pages, Coming soon gate. Findings with `basis` observed / heuristic / unavailable, history states (new / ongoing / recurred / resolved) |
| Public check | `app/check`, `app/api/check`, `lib/public-scan*.ts`, `lib/public-fetch.ts`, `lib/protection.ts`, `lib/shopify.ts`, `lib/woo-store-api.ts` | No login. WooCommerce + Shopify. Hardened `PublicFetcher` (undici, DNS check at connect time, redirect re-check, 10 requests, size and time limits), IP-hash daily rate limit, 24 h cache per domain |
| AI visibility | `lib/visibility*.ts`, `lib/engines.ts`, `lib/gemini.ts`, `lib/grounding.ts`, `lib/grounded-question.ts`, `lib/profile.ts`, `lib/share-of-voice.ts`, `lib/question-suggest.ts`, `app/stores/[id]/visibility/*` | Gemini answers (ungrounded unless `GEMINI_GROUNDING_ENABLED`), names extracted by Groq → NVIDIA → Gemini (`lib/task-models.ts`), brand profile, share of voice, citations page, question suggestions from products |
| AI traffic | plugin `class-agsc-traffic.php`, `-burst.php`, `-check.php`, `-sender.php`; app `app/api/ingest/traffic`, `lib/traffic.ts`, `app/stores/[id]/traffic` | Daily totals per source / type / confidence / route / status, HMAC-signed sends, signed `X-AgentScope-Check` skip, burst detection (`likely-checker-tool`) |
| Plugin distribution | `scripts/build-plugin.mjs`, `lib/plugin-release.{ts,json}`, `app/api/plugin/latest`, `class-agsc-updater.php` | Zip + SHA-256, daily update check, checksum verified before install |
| Marketing, legal, SEO | `app/page.tsx`, `app/pricing`, `app/terms`, `app/privacy`, `lib/site.ts`, `lib/plans.ts`, `lib/seo.ts`, `app/robots.ts`, `app/sitemap.ts`, `app/opengraph-image.tsx` | Landing, pricing (waitlist for paid plans), legal pages, metadata |
| Jobs | `vercel.json` (one daily cron), `app/api/cron/weekly-scans` | Scans and visibility runs are synchronous HTTP requests (`maxDuration = 300`) |

### Tables (all with RLS on)

`stores`, `store_credentials`, `scans`, `findings`, `traffic_connectors`, `traffic_daily`, `visibility_prompts`,
`visibility_runs`, `visibility_results`, `workspaces`, `workspace_members`, `workspace_invites`, `public_reports`,
`public_scan_limits`, `public_gemini_usage`, `public_mistral_usage`, `grounding_usage`, `grounding_usage_daily`,
`plan_waitlist`, `shopify_waitlist`. Member tables use `private.store_role(store_id)`; usage, waitlist, credential,
connector and invite tables have no policies (service role only).

## 2. Security review: gaps found

| # | Gap | Where | Risk | Fix (ticket) |
| --- | --- | --- | --- | --- |
| S1 | Two fetchers. `lib/woo.ts` `safeFetch` / `fetchPublicPage` check DNS with `lookup()` and then call `fetch()`, which resolves again (DNS-rebinding window). Only `PublicFetcher` checks at connect time | `lib/woo.ts` | A store host could point to a private address between check and connect | B0: one hardened fetcher (`lib/safe-fetch.ts`, undici connect-time lookup) used by `woo.ts`, `public-fetch.ts`, future competitor fetches |
| S2 | No http support decision: today https only (stricter than the spec) | all fetchers | none (keep https-only for stores; allow http only for robots/llms of competitors if ever needed) | B0 |
| S3 | No per-tenant cost cap. Gemini/Groq usage is counted per run and app-wide for the public check, not per workspace per day | `lib/visibility-run.ts`, `lib/public-scan-run.ts` | A tenant can use the whole free quota | B6: `usage_events` table + daily cap per workspace with alert |
| S4 | Plugin update check runs inside `pre_set_site_transient_update_plugins`; when the daily cache expires an admin page load waits for one HTTP request (10 s timeout) | `class-agsc-updater.php` | Slow admin page once a day (not shoppers) | B2: fetch only from WP-Cron, read cache in the filter |
| S5 | Plugin accepts no inbound payloads yet; Milestone D needs signed inbound calls | plugin | none today | D: HMAC-signed REST route with nonce + timestamp + capability |
| S6 | Ownership verification = a working WooCommerce key only; no DNS TXT / meta tag / file method; public check can run on any domain (read-only, rate limited) | `app/stores/actions.ts` | Deep scans on a store you do not own need its key, so low risk; needed for Shopify and write actions | B: `store_verifications` |
| S7 | No CAPTCHA on unauthenticated tools | `/check`, waitlists | Abuse limited by IP-hash rate limit and honeypot | E (needs Cloudflare Turnstile) |
| S8 | Old owner-only RLS policies are disabled with `using (false)`, not dropped | migration 20261022141000 | none (no access), but clutter | drop from the SQL editor when convenient |
| S9 | Visibility answers store engine, model and grounding flag, but not country, language or "access method" as fields | `visibility_results` | UI cannot show the full provenance line | C1: add columns |
| S10 | Scan routes run up to 300 s inside one request; the daily cron loops over all stores in one invocation | `app/api/*`, `app/api/cron/weekly-scans` | Timeouts as stores grow | B9: job queue (section 4) |

Escaping: the plugin prints no JSON-LD today; when it does (D2) it must use `wp_json_encode($data, JSON_HEX_TAG | JSON_HEX_AMP)`.
Plugin page-load path today: one local `INSERT … ON DUPLICATE KEY` on `shutdown` for AI-bot/referral requests only,
plus a transient read/write for burst detection. No network call on the front end.

## 3. Files and tables to add or modify (by milestone)

**Milestone A** (code exists on branch `claude/agentscope-v0-1-setup-6cez8h`, not applied or tested)
- add `lib/ai-orders.ts`, `lib/checkout.ts`, `lib/funnel.ts`, `lib/orders-sync.ts`, `app/stores/[id]/revenue/*`, `app/api/stores/[id]/orders/route.ts`
- modify `lib/scan.ts` (checkout checks + order sync), `lib/woo.ts` (orders, shipping zones, payment gateways), `lib/categories.ts` (area `checkout`), `lib/plans.ts` (`aiRevenue`), `components/nav.tsx`, `/pricing`, `/privacy`
- plugin: add `class-agsc-attribution.php` (AI referral captured into the WC session, written to order meta at order creation, classic and block checkout, HPOS-declared)
- migration `20261023090000_ai_revenue.sql`: `workspaces.plan`, `ai_orders`, `order_syncs`

**Milestone B**
- add `lib/safe-fetch.ts` (S1), `lib/platform/adapter.ts` + `lib/platform/woocommerce.ts` (+ contract tests), `lib/schema-source.ts`, `lib/jobs/*`, `lib/i18n/*` with `next-intl`, `messages/en.json`, `messages/ar.json`
- plugin: HPOS declaration, bot-hit buffer + batch flush (`class-agsc-bothits.php`), updater moved to WP-Cron (S4)
- migrations: `jobs`, `job_steps`, `bot_hits` (+ verification fields), `bot_ip_ranges` cache, `usage_events`, `store_verifications`, `visibility_results` provenance columns

**Milestone C/D**: `visibility_prompts` market/language, `product_impacts`, `fix_queue` view, `fixes`, `fix_audit_log`, `fix_snapshots`, generators under `lib/fixes/*`, plugin signed `apply`/`revert` routes.

## 4. Background jobs on Vercel (free tiers)

Constraints: Vercel Hobby allows only daily cron jobs (the project already uses one); a function runs at most 300 s.

- **Table `jobs`** (id, workspace_id, store_id, kind, status queued/running/succeeded/failed/cancelled, attempt,
  max_attempts, run_after, locked_until, progress jsonb, error, created_by, timestamps) and **`job_steps`**
  (job_id, step_key, status, attempt, result jsonb, unique (job_id, step_key)).
- **Idempotent steps**: each step has a stable key (`products:page:3`, `visibility:prompt:<id>`,
  `orders:page:2`); a step that already succeeded is skipped; writes use upserts on natural keys.
- **Claiming**: `claim_job()` SQL function with `FOR UPDATE SKIP LOCKED` sets `locked_until = now() + 4 min`;
  an expired lock means the worker died and the job can be claimed again.
- **Driver** (no paid queue): `POST /api/jobs/tick` runs steps for up to ~240 s then returns. It is called
  (1) right after a job is created, (2) by the open page while the user watches (polling every few seconds),
  (3) every minute by Supabase `pg_cron` + `pg_net` with a secret header (free on Supabase), and (4) by the existing
  daily Vercel cron as a fallback.
- **Retries**: failed step → `attempt + 1`, `run_after = now() + 2^attempt × 30 s`, max 3; then job `failed` with the
  exact reason. Rate limits (429 + Retry-After) reschedule without counting as a failure.

## 5. Shopify integration model (later, needs a Partner account)

- Public checks now (already live: `/products.json`, JSON-LD, bot access).
- App later: OAuth with **read scopes by default** (`read_products`, `read_orders` for attribution only with consent,
  `read_content`, `read_shipping`, `read_markets`). Write scopes (`write_products` for metafields) requested only when
  the merchant opts in to a fix. **Never `write_themes`, never `ScriptTag`.** JSON-LD through a Theme App Extension
  (app embed the merchant turns on); attribution through a Web Pixel that respects the Customer Privacy API.
- Tokens in Vault like WooCommerce keys; webhooks verified with HMAC; GDPR webhooks implemented.
- Same `StorePlatformAdapter` contract as WooCommerce.

## 6. Ownership verification

| Method | Proves | Used for |
| --- | --- | --- |
| WooCommerce REST key (Read) that answers for the store's host | admin access to the store | deep scans (today) |
| WooCommerce write key, separate Vault secret | write access | opt-in fixes (D4) |
| Plugin connection (signed sends with the per-site token) | code running on the site | traffic, bot verification, plugin-applied fixes |
| DNS TXT `agentscope-verification=<token>` on the domain | control of the domain | any platform, Shopify before the app |
| `<meta name="agentscope-verification" content="<token>">` or `/.well-known/agentscope-verification.txt` | control of the site | when DNS is not accessible |
| Shopify OAuth install | shop owner/staff | Shopify deep scans |

Verification results are stored per store with method, verified_at and an expiry for re-checks.
