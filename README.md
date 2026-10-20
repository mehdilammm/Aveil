# AgentScope (v0.1)

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
- Each finding has a stable key (`type:product_id`). States: `new`, `ongoing` (in the previous complete scan), `recurred` (seen earlier but not in the previous scan). `resolved` is shown on the findings page: in the previous scan, gone now.

## Scripts

- `npm test`: rule, history and URL tests
- `npm run typecheck`, `npm run build`

Migrations live in `supabase/migrations`.
