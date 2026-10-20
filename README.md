# AgentScope (v0.1)

Checks whether WooCommerce stores are ready for AI shopping agents.
Loop: evidence → specific fix → rescan → history.

Stack: Next.js (App Router, TypeScript), Supabase (Auth + Postgres), Vercel.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill it in:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public)
   - `SUPABASE_SERVICE_ROLE_KEY` (server only)
   - `CREDENTIALS_ENCRYPTION_KEY`: `openssl rand -base64 32` (server only; losing it makes saved API keys unreadable)
3. `npm run dev`

On Vercel, set the same four variables. In Supabase Auth → URL Configuration, add the site URL and `<site>/auth/confirm` as a redirect URL.

## How it works

- `stores`: owned by the user, written with the user's session (RLS).
- `store_credentials`: WooCommerce key and secret, AES-256-GCM encrypted on the server, bound to the store id. RLS on with no policies and no grants for `anon`/`authenticated`, so only the service role can read it. Never sent to the browser.
- `POST /api/stores/:id/scan`: checks ownership, reads published products from `/wp-json/wc/v3/products` (100 per page, up to 50 pages) and the variations of variable products, applies `lib/rules.ts`, and saves the scan and findings with the service role.
- Each finding has a stable key (`type:product_id`). States: `new`, `ongoing` (in the previous complete scan), `recurred` (seen earlier but not in the previous scan). `resolved` is shown on the findings page: in the previous scan, gone now.

## Scripts

- `npm test`: rule, history, URL and crypto tests
- `npm run typecheck`, `npm run build`

Migrations live in `supabase/migrations`.
