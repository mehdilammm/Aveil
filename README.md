# AgentScope (v0.6)

Checks whether WooCommerce stores are ready for AI shopping agents.
Loop: evidence → specific fix → rescan → history.

Stack: Next.js (App Router, TypeScript), Supabase (Auth + Postgres), Vercel.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill it in:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public)
   - `SUPABASE_SERVICE_ROLE_KEY` (server only)
   - `ADMIN_EMAILS` (optional): who may open `/api/health`
3. `npm run dev`

On Vercel, set the same variables. `/api/health` (signed in) shows whether each is set and whether the service role key works, without showing values. In Supabase Auth → URL Configuration, add the site URL and `<site>/auth/confirm` as a redirect URL.

## How it works

- `stores`: owned by the user, written with the user's session (RLS).
- WooCommerce key and secret are stored in Supabase Vault. `store_credentials` keeps only the Vault secret ids and a key hint. They are written and read through `save_store_credentials` / `get_store_credentials` (security definer, executable only by the service role). Never sent to the browser. If saving fails, the new store is removed.
- `POST /api/stores/:id/scan`: checks ownership, reads published products from `/wp-json/wc/v3/products` (100 per page, up to 50 pages) and the variations of variable products, applies `lib/rules.ts`, and saves the scan and findings with the service role.
- Store pages: Shop, Cart, Checkout and Terms come from WooCommerce settings (`/wc/v3/settings/products` and `/advanced`, basis `observed`) and are checked against the public `/wp/v2/pages` list. WooCommerce does not expose the Privacy or Returns page setting to API keys, so those are found by title or address among published pages (basis `heuristic`). When the key or site does not allow a read, the finding has basis `unavailable` with the reason; nothing is guessed.
- After each scan the store's `connection_status` becomes `connected`, or `error` with `connection_error`.
- Deleting a store (Settings) cascades to scans, findings and credentials; a trigger removes the Vault secrets.
- Reports: CSV of the latest scan (`/api/stores/:id/report.csv`, formula-injection safe) and scan history.
- Each finding has a stable key (`type:product_id`). States: `new`, `ongoing` (in the previous complete scan), `recurred` (seen earlier but not in the previous scan). `resolved` is shown on the findings page: in the previous scan, gone now.

## Scripts

- `npm test`: product rules, store pages, connection status, CSV, history and URL tests
- `npm run typecheck`, `npm run build`

Migrations live in `supabase/migrations`.

## v0.3: Agent Readiness

- **Feed** (`lib/feed.ts`): product data against the required fields of OpenAI's product feed
  ([spec](https://developers.openai.com/commerce/specs/file-upload/products)): title, description, url, brand, availability,
  seller_name, currency; GTIN check digit; low note when there is neither GTIN nor MPN. Image and price come from the product rules.
- **Access** (`lib/access.ts`): home page and two product pages loaded as a browser and as GPTBot, OAI-SearchBot, ChatGPT-User,
  ClaudeBot and PerplexityBot (10 requests, one at a time). User agent only, so findings are heuristic.
- **Structured data** (`lib/robots.ts`, `lib/structured-data.ts`): robots.txt per bot and Sitemap line, JSON-LD Product compared
  with the API, llms.txt as information only.
- **Traffic** (`/api/ingest/traffic`, `lib/traffic.ts`): signed daily totals from the agentscope-core plugin
  (`wordpress/agentscope-core/includes/class-agsc-sender.php`).
- **Scheduled scans** (`vercel.json`, `/api/cron/weekly-scans`): runs daily, scans stores whose last complete scan is 7+ days old,
  at most one scheduled scan per store per day. Needs `CRON_SECRET` in Vercel.
- **Weekly report**: Reports page, fixed / new / came back.

## Weekly email (not connected)

`lib/email.ts` renders the weekly email as text. Nothing sends it until a provider is chosen. Options (check current prices):

| Provider | Free tier | Paid |
| --- | --- | --- |
| Resend | 3,000 emails/month, 100/day | from about $20/month |
| Brevo | 300 emails/day | from about $9/month |
| Postmark | 100 emails/month | from about $15/month |
| Amazon SES | none after the first year | about $0.10 per 1,000 emails, more setup |

All need a verified sending domain (DNS records).

## v0.4: AI Visibility (Gemini API)

- Up to 15 questions per store (`visibility_prompts`, owner-managed with RLS). "Suggest 5 questions" builds them from the
  store's biggest product categories and country; nothing is saved until the user ticks them.
- A run sends each question once to the Gemini API (`lib/gemini.ts`, default `gemini-3.5-flash-lite`, override with
  `GEMINI_MODEL`), one at a time, 25 s timeout, one retry on 429/5xx. Google Search grounding is off: it is not in the
  free tier for this model and is billed per search on paid tiers.
- One run per store every 7 days (failed runs do not count). Requests and tokens are stored on `visibility_runs`.
- Each answer is stored in full (`visibility_results`) with: mentioned or not (text match), rank in the answer's list,
  other shops named and links. Shop names come from a second small structured-output request to the same model
  (`EXTRACTION_SCHEMA`), filtered for labels; if it fails, a text heuristic is used (`extraction` column says which).
  Tokens of both requests are counted. Labelled "Gemini API answer, not the Gemini app".

## v0.5: Public check (no login)

`/check` lets anyone check a store's public side; reports live at `/check/<random id>` for 30 days. `/bot` explains
AgentScopeBot and how to block it.

- Checks: robots.txt per AI bot (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot, Google-Extended) and
  sitemap; llms.txt; home page as four AI bots vs. our normal request (user agent only, heuristic); JSON-LD Product on two
  product pages (home page links, else the product sitemap) and its price vs. the price shown; WooCommerce detection and
  Coming soon / maintenance; two Gemini questions: a general one built from the home page's categories or description
  without the store's name (the visibility signal), and "Does Gemini know this store?" by domain (information only).
  Competitor names keep only stores, marketplaces and brands (typed by a structured-output request), without the store,
  its parent domain or same-brand names, de-duplicated ("Alibaba" = "Alibaba.com").
- Limits: 10 HTTP requests per check (redirect hops count), 1.5 s apart, 10 s timeout, 2 MB per answer, https only, DNS checked
  at connect time (undici dispatcher) and on every redirect (max 3). User agent `AgentScopeBot/1.0`, header
  `X-AgentScope-Check: 1`; if robots.txt blocks AgentScopeBot, only robots.txt is read.
- Same domain within 24 h returns the saved report. 5 checks per hour per visitor (IP kept only as a daily HMAC).
  Gemini: once per domain per 24 h (2 questions + 2 extractions) and 50 requests per day for the whole app.
- Tables `public_reports`, `public_scan_limits`, `public_gemini_usage`: server only (RLS, no policies).

## v0.6: Shopify in the public check

- Platform: WooCommerce / Shopify (cdn.shopify.com, Shopify.theme, /cdn/shop/, Shopify headers) / WordPress / unknown.
- Shopify product pages: /products/<handle> links from the home page, else handles from /products.json, else the
  sitemap index → sitemap_products_1.xml. Same JSON-LD and price checks (Dawn-style sale price).
- /products.json?limit=10, one request, no pagination: price missing or 0, compare-at not higher than price, no images,
  short description, empty vendor, all variants unavailable, shipped variants with 0 g. Not public → unavailable, not a problem.
- CTA: WooCommerce → full scan sign-up; Shopify → waitlist with optional email (`shopify_waitlist`, server only, nothing sent).
- Gemini: each question reserves 2 requests (question + extraction) in the daily budget, so an asked question always gets its
  extraction; the extraction reply gets 2048 output tokens and a cut-off reply keeps its complete entries.
