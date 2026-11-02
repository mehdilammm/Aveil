# AgentScope security audit (2026-10-31)

Audit only: nothing was changed. Each finding says whether it was **proved** (run against production at
agentscope-peach.vercel.app, build `6439d34`, or locally) or **reasoned** (read from the code or config).

## 1. Threat model

**Assets**
- Merchants' WooCommerce read and write keys: Supabase Vault; `store_credentials` and `store_write_credentials` hold
  only the Vault ids.
- Plugin HMAC tokens: Vault, via `traffic_connectors`.
- Supabase service role key, Gemini / Groq / NVIDIA / Mistral keys, `CRON_SECRET`: Vercel env (project-wide), and
  the job tick secret (Vault).
- Customer data: findings, orders without PII, AI answers, bot IPs, emails.
- The ability to write to stores (auto-fix, one-click, CSV import, plugin `/fixes`).
- Billing plan (Pro features).

**Attackers and what they can reach**

| Attacker | Entry points | Worst realistic goal |
|---|---|---|
| Anonymous internet user | `/check`, `/r/<token>`, signup/login, `/api/waitlist`, `/api/plugin/latest`, plugin ingest endpoints (`/api/ingest/*`) | Make our servers scan third-party sites at scale, burn AI quota, guess tokens |
| User of another workspace | Every `/api/stores/[id]/*`, server actions, Supabase REST with their own JWT | Read or write another workspace's store (IDOR) |
| Viewer or admin inside a workspace | Same routes with a real role | Viewer triggering writes; admin deleting stores or keys |
| Malicious store (we scan it) | HTML, JSON-LD, robots.txt, redirects, huge responses, WooCommerce API answers | SSRF to internal addresses, key leak through a redirect, memory DoS, fake findings |
| Malicious website in the headless browser | Any page the browser test opens (verified stores, Pro) | Chrome exploit, then the function's secrets |
| Compromised WordPress site running our plugin | Signed ingest calls, `/fixes` replies | Forged traffic or events for its own store; replay |
| Supply chain | npm packages, `@sparticuz/chromium`, our plugin zip and update channel | Code running in our functions or on every merchant's WordPress |

**Trust boundaries**
- Browser → Next.js: cookie session; every route re-checks membership.
- Next.js → Supabase: the user JWT under RLS, or the service role after a membership check.
- Next.js → stores: the guarded fetcher.
- Next.js → plugin: HMAC + nonce.
- Plugin → Next.js: HMAC + timestamp + replay table.
- Next.js → plugin update: zip + sha256 from the same host (see H2).

## 2. Routes and server actions (all checked on the server)

`canEdit` = owner or admin. `fixAccess` = signed in + member + owner/admin + ownership verified (`lib/fix-access.ts:8`).

| Route / action | Auth | Membership / role | Plan | Rate limit |
|---|---|---|---|---|
| POST `/api/check` | public | — | — | 5/h per IP hash (`app/api/check/route.ts:39-42`), 24 h cache per host |
| POST `/api/waitlist` | public | — | — | per IP (`app/api/waitlist/route.ts:24`) |
| GET `/api/plugin/latest` | public | — | — | CDN cache 1 h |
| POST `/api/ingest/traffic`, `/bot-hits`, `/events` | HMAC (Vault token) + timestamp skew + replay table | store from the signature | events: plan per kind | `traffic_rate_check` per store |
| POST `/api/jobs/tick` | `x-jobs-secret` checked in the DB (`jobs_tick_secret_matches`); 404 otherwise | — | — | — |
| POST `/api/jobs/browser` | `Bearer CRON_SECRET`, constant time; 404 otherwise | job must be `agent_sim_browser` and running | — | — |
| GET `/api/cron/weekly-scans` | `Bearer CRON_SECRET`, constant time; 401 | — | per plan | — |
| GET `/api/health` | signed in + `ADMIN_EMAILS`; 404 otherwise | — | — | — |
| GET `/api/jobs/[id]` | signed in | RLS on `jobs` | — | — |
| POST `/api/stores/[id]/scan`, `/verify`, `/visibility`, `/visibility/reread`, `/orders`, `/alerts`, `/share`, `/simulate` | signed in | `storeAccess` + `canEdit` (test run: owner only) | orders, share, browser: plan | `storeLimit` per store (scan, verify, reread, simulate) |
| GET `/api/stores/[id]/report.csv`, `/descriptions.csv` | signed in | member (descriptions: `canEdit`) | — | — |
| POST `/api/stores/[id]/url` | signed in | owner only | — | — |
| `/api/stores/[id]/fixes`, `/fixes/bulk`, `/fixes/import`, `/fixes/undo`, `/autofix`, `/write-key` | `fixAccess` | owner/admin + verified ownership | auto-fix: plan | — |
| GET `/api/workspaces/[id]/export` | signed in | owner only | — | — |
| `/auth/confirm`, `/auth/signout`, `/check/[id]/continue` | Supabase OTP / session | — | — | — |
| Actions `logIn`, `signUp` | Supabase Auth | — | — | Supabase |
| Action `joinWaitlist` (pricing) | public | — | — | **none** (L12) |
| Actions `createInvite`, `revokeInvite`, `removeMember`, `deleteWorkspaceAction` | signed in | owner only | members: plan | — |
| Action `acceptInvite` | signed in | token hash, single use, expiry, optional email binding | — | — |
| Actions `addStore`, `deleteStore`, `createTrafficToken`, `disconnectTraffic`, ownership, descriptions, prompts | signed in | `canEdit` (store insert and delete also under RLS) | stores and questions: plan | — |

## 3. Findings

Severity: **Critical** = exploitable now with large impact; **High** = large impact, needs a precondition; **Medium**; **Low**.

| # | Sev | Finding | Evidence | Proved / reasoned |
|---|---|---|---|---|
| H1 | High | Untrusted pages run in a Chrome without sandbox, inside a function that holds every secret | `@sparticuz/chromium` args `--no-sandbox --single-process --no-zygote --disable-web-security` (checked locally); `lib/browser-sim-run.ts:72-80`; `app/api/jobs/browser/route.ts:24` uses `createAdminClient`; Vercel env vars are project-wide, so this function also has Gemini/Groq/NVIDIA/Mistral keys and `CRON_SECRET` | Args proved locally; impact reasoned |
| H2 | High | Plugin update channel: the zip and its sha256 come from the same server | `lib/plugin-release.ts:18-30`; `class-agsc-updater.php:44-63,167` checks the hash it got from that same server | Reasoned |
| M1 | Medium | No security headers except HSTS: no CSP, no `frame-ancestors` / X-Frame-Options (clickjacking on Undo, Delete store, Approve auto-fix), no `nosniff`, no Referrer-Policy, no Permissions-Policy | `curl -I /` returns only `strict-transport-security` | Proved |
| M2 | Medium | An **admin** (not owner) can delete a store: server action and directly through Supabase REST (authenticated has DELETE under RLS); no audit row | `app/stores/actions.ts:101-106` (`canEdit`); grant listed in §0 of the request | Reasoned (code + grants) |
| M3 | Medium | `/check` abuse: only 5/h per IP, no global daily cap, no CAPTCHA. Many IPs can make us fetch arbitrary third-party sites (up to 10 requests each) and use AI quota | `app/api/check/route.ts:39-42`; `lib/public-scan.ts:91` | Reasoned |
| M4 | Medium | Session cookie `sb-*-auth-token`: `Secure=false`, `HttpOnly=false`, lifetime 400 days. Script injection anywhere (none found today) would steal sessions, and the long life widens the window | Playwright login on production | Proved |
| M5 | Medium | WooCommerce API responses are read with `res.json()` and no size cap; a malicious store can return a huge body and exhaust the function's memory (the tick runs other stores' jobs in the same call) | `lib/woo.ts:66`, `lib/woo.ts:238`, `lib/woo.ts:492` (the public fetcher caps bytes, `lib/public-fetch.ts:72-89`, this one does not) | Reasoned |
| L1 | Low | `npm audit --omit=dev`: 3 high, all one chain (zod < 4.6.6 memory DoS ← chromium-bidi ← puppeteer-core 25.11). Reachable only through the WebDriver BiDi protocol; we use CDP | `npm audit` output | Proved (report); reachability reasoned |
| L2 | Low | Chromium freshness: `@sparticuz/chromium` 153.0.0 pinned, no update routine | `package.json:14` | Reasoned |
| L3 | Low | Browser test: downloads not denied; popups and other targets are not intercepted or closed (traffic still goes through the guarded proxy) | `lib/browser-sim.ts:115-139` | Reasoned |
| L4 | Low | Invite links without an email are bearer links (single use, expire, 192-bit token, only the hash is stored) | `lib/workspace.ts:51-69` | Reasoned |
| L5 | Low | Account deletion leaves `workspace_invites` addressed to that email (waitlists are covered) | `delete_account_data` definition (checked in the DB) | Proved (DB) |
| L6 | Low | `/check` hashes IPs with `SUPABASE_SERVICE_ROLE_KEY` as the HMAC key (key reuse: rotating the key changes the hashes, and the key travels to more code) | `app/api/check/route.ts:39-40` | Reasoned |
| L7 | Low | WooCommerce fallback sends the keys as query parameters when a host strips `Authorization` (they land in the merchant's own access logs) | `lib/woo.ts:57-61` | Reasoned |
| L8 | Low | `/api/plugin/latest` builds `download_url` from the request origin and is publicly cached; moot once H2 is fixed, but a fixed `SITE.url` is simpler | `app/api/plugin/latest/route.ts:6`, `lib/plugin-release.ts:22` | Reasoned |
| L9 | Low | No alerting: failed-login bursts, `/check` bursts, job failures and write failures only reach `console.error` | 25 `console.*` calls; none log keys or tokens | Reasoned |
| L10 | Low | Backups: Supabase Free has no point-in-time recovery and no downloadable backups; there is no restore plan | Plan | Reasoned (to confirm in the dashboard) |
| L11 | Low | Service role key exposed in chat earlier: rotation and revocation not verifiable from here | — | Not verifiable |
| L12 | Low | Pricing waitlist server action has no rate limit (spam rows); `/api/waitlist` has one | `app/pricing/actions.ts:11-17` | Reasoned |
| L13 | Low | Known: `pg_net` in schema public; leaked-password protection off (needs Supabase Pro) | §0 | DB |

### Checked and OK

**Proved on production**
- IDOR, with the demo session against another workspace's store, job and audit row. All of these were refused:
  - `GET /api/jobs/<other>` → 404
  - `POST /api/stores/<other>/scan`, `/share`, `/fixes/undo`, `/write-key` → 404
  - `GET /api/stores/<other>/report.csv` → 404
  - Undo of another store's `audit_id` through the demo's own store → 403, then scoped by `store_id` (`lib/autofix.ts:234`)
- Admin and internal routes without the secret: `/api/health` → 404, `/api/jobs/tick` → 404, `/api/jobs/browser` → 404, `/api/cron/weekly-scans` → 401.
- Logout invalidates the session: the old cookies replayed after sign-out land on `/login`.
- CORS: `OPTIONS` from a foreign origin returns no `Access-Control-Allow-*`. Cross-site POSTs carry no session because the cookie is SameSite=Lax.
- The secret-pattern scan (Supabase secret keys, JWTs, Gemini, Groq and NVIDIA keys, WooCommerce `ck_`/`cs_` keys, private keys) found no match:
  - in the client bundle (`.next/static`, local build);
  - in the git history (219 commits, all branches);
  - and no tracked `.env` file.

**Reasoned from code**
- SSRF:
  - Store URLs go through one guarded client with a DNS check at connect time (blocks private, loopback, link-local and IPv6 ULA; `lib/safe-fetch.ts:18-35`).
  - Redirects are followed one hop at a time and re-checked; WooCommerce credentials never follow a redirect to another host (`lib/woo.ts:22-36`).
  - The browser's traffic goes through a proxy that allows only CONNECT to port 443, with the same DNS check (`lib/browser-proxy.ts`), and WebRTC/QUIC are off.
  - The only raw `fetch` calls go to fixed AI endpoints, to our own `/api/jobs/browser`, or run inside the browser page.
- Plugin:
  - REST routes: `/summary`, `/scan`, `/settings`, `/selftest` require `manage_options`; `/fixes` requires HMAC + timestamp ±skew + a 32-hex nonce stored and refused on reuse (`class-agsc-fixes.php:63-96`).
  - Admin actions use `admin_post` with nonces.
  - No `eval`, `unserialize` of remote data, or file writes.
- Writes to stores:
  - Every write route needs owner/admin + verified ownership (`fixAccess`); viewers get 403.
  - Undo is scoped by store.
  - The CSV import applies exactly the previewed hash.
- XSS:
  - React escapes everything.
  - The one `dangerouslySetInnerHTML` is our own JSON-LD with `<` escaped (`app/page.tsx:27`).
  - The Google grounding HTML sits in a sandboxed iframe without scripts.
  - Links from AI answers are `https?://` only, and React 19 blocks `javascript:`.
  - Plugin JSON-LD uses `JSON_HEX_TAG | JSON_HEX_AMP`.
  - CSV cells starting with `= + - @ \t \r` are prefixed (app `lib/csv.ts`, plugin `csv_cell`).
- Prompt injection: model outputs only produce competitor names, a topic and question suggestions. Each goes through a validator, and none creates findings, marks anything resolved, or triggers a write. Mention detection is string matching on the answer, not a model verdict.
- SQL: no string-built SQL. RPC parameters are bound.
- Tokens:
  - Invite, share and ownership tokens are random. Only their SHA-256 is stored, and they expire and can be revoked.
  - `/r` sets `noindex` and `no-referrer`.
- Store deletion cascades to keys, connectors, share links, bot hits and the audit log, and DB triggers delete the Vault secrets.

## 4. Proposed fixes, in order (nothing done yet)

1. **H1. Browser isolation.**
   - Move the browser test to a separate Vercel project (`agentscope-browser`) whose only env var is a shared HMAC secret.
   - `tick` sends `{store url, check token, budget}` signed, gets the result back and does all DB writes; the browser project never has the service role key or AI keys.
   - Also: `Browser.setDownloadBehavior: deny`, close every new target, cap pages.
   - Keep `--no-sandbox`, which Lambda requires (no user namespaces), but document it.
   - Monthly `@sparticuz/chromium` / `puppeteer-core` update (also fixes L1, L2, L3).
2. **H2. Signed plugin releases.**
   - Ed25519 key pair kept offline. `scripts/build-plugin.mjs` writes `sha256` + `signature`.
   - The plugin embeds the public key and verifies with `sodium_crypto_sign_verify_detached` in `upgrader_pre_download` before installing; it refuses unsigned updates.
   - Needs a plugin release (1.9.0) → your APPROVED line.
3. **M1. Headers** in `next.config.ts`:
   - `Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co; frame-src https://www.google.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`, with a nonce from `proxy.ts`.
   - `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
   - Roll out CSP report-only first.
4. **M2. Store deletion.**
   - Owner only, through a server route that writes an audit row; the server action stays as the UI.
   - Migration: revoke DELETE on `stores` from `authenticated` (→ APPROVED line).
5. **M4. Cookie.** `cookieOptions: { secure: true, sameSite: "lax", maxAge: 30 days }`. `httpOnly: true` if no browser-side Supabase client needs the token (to verify: today auth runs on the server).
6. **M5. Size cap** on WooCommerce and write responses (stream with `maxBytes`, like `public-fetch.ts`).
7. **M3. `/check`.**
   - A global daily cap and a per-target-domain cap (DB counter).
   - Cloudflare Turnstile on the form: new external service → your OK.
8. **Low batch.**
   - Invites must name an email (L4); delete invites on account deletion (L5, migration); a dedicated `IP_HASH_SECRET` (L6); fixed `SITE.url` in `/api/plugin/latest` (L8); waitlist action rate limit (L12).
   - Alerts (L9): a daily digest from `jobs` and `fix_audit_log` failures, plus a burst alert on `public_scan_limits`.
   - Backup plan (L10): nightly `pg_dump` from a GitHub Action to encrypted storage, plus a tested restore; or Supabase Pro (PITR) when you upgrade.
   - L11: rotate the service role key in Supabase, disable legacy JWT keys, and update the Vercel env.

## 5. Answer to the question in §0

Yes. Store deletion should be owner-only and go through a server route, with the Vault cleanup (already done by
triggers) and an audit row, and the browser-side DELETE grant should be revoked (M2).

## 6. Fix status (approved 2026-10-31: H1 → H2 → M1 → M2 → M4 → M5 → M3 → Low batch)

| # | Status | What was done | Proof |
|---|---|---|---|
| H1 | Done, proved on production 2026-11-01 (matha: job a8aec1a9 succeeded through agentscope-browser, 19.5 s, order never placed, cart emptied) | Browser test moved to the Vercel project `agentscope-browser` (`browser-runner/`, Build Output API, one function `/api/run`). It holds only `BROWSER_RUNNER_SECRET`: no service role, no AI keys, no store token. The app checks ownership, signs the X-AgentScope-Check value (valid 10 min), signs the request (HMAC + timestamp ±5 min, body with a nonce) and saves the result. `--disable-web-security` removed, downloads denied, any opened window closed. `--no-sandbox` stays (Lambda has no user namespaces). The old `/api/jobs/browser` is deleted and the app ships no Chromium. | Local: unsigned → 404, old timestamp → 404, http store → 400, signed → 200 (`lib/browser-remote.test.ts`). Production runner: `/api/run` without a signature → 404. Bundle contains no Supabase or AI key code |
| H2 | Code done, waiting for the public key | The updater accepts a release only if the Ed25519 signature of `agentscope-core|<version>|<sha256>` verifies with the embedded public key, re-checks the cached answer, then checks the zip's SHA-256. `scripts/plugin-keygen.mjs` (run offline), `scripts/sign-plugin.mjs` + `.github/workflows/sign-plugin.yml` (key = GitHub secret `PLUGIN_SIGNING_KEY`), and the build refuses a release without the public key | `lib/plugin-release.test.ts` (PHP harness): unsigned, wrong key, swapped zip or version → refused; signed → installed |
| M1 | Done | CSP with a per-request nonce (`script-src 'self' 'nonce-…' 'strict-dynamic'`, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP, no `x-powered-by` | Report-only, then enforced: 0 violations on 21 pages (Playwright, production) |
| M2 | Code done, migration to apply | Only the owner deletes a store, on the server, after a `store_deletions` row is written (no row → no deletion). Migration `20261101090000_store_deletion_owner_only.sql` revokes DELETE from the browser role | Until the migration is applied, deletion is refused (fails closed) |
| M4 | Done | Session cookie `Secure`, `HttpOnly` (no browser-side Supabase client exists), `SameSite=Lax`, 7 days, renewed on each visit that refreshes the session | Production: `httpOnly: true, secure: true, Lax, 7 days` |
| M5 | Done | WooCommerce answers (reads and writes) are read up to 16 MB, then refused | `lib/woo-size-cap.test.ts` |
| M3 | Done (Turnstile later) | Global cap of 300 fresh `/check` scans per UTC day (cached reports do not count), on top of 5/h per IP | — |
| L1 | Done | puppeteer-core 25.16.0: `npm audit --omit=dev` 0 vulnerabilities (app and runner) | `npm audit` |
| L2 | Done | Dependabot: runner Chromium/puppeteer-core/undici weekly, app monthly | `.github/dependabot.yml` |
| L3 | Done (H1) | — | — |
| L4 | Done | An invite needs the invitee's email (only that account can accept it) | — |
| L5 | Migration to apply | `20261101090100_account_delete_invites.sql` | — |
| L6 | Done, env to set | IP hashes use `IP_HASH_SECRET` (falls back to the service key until it is set) | — |
| L8 | Done | `/api/plugin/latest` uses the app's own address | test |
| L12 | Done | Pricing waitlist: 5/h per IP | `lib/plans.test.ts` |
| L7, L9, L10, L11, L13 | Open | Need a decision, a new service, a migration or a dashboard action (see §4) | — |

## 7. Cloudflare security-audit skill runs (local outputs in audit/security-run-1, -2; git-ignored)

| # | Lead | Status |
|---|---|---|
| N1 | Unsigned ingest requests used up a store's hourly quota | Fixed: signature checked first (test + production: unsigned → 401) |
| N2 | Invite accepted with an unconfirmed email | Closed by Supabase "Confirm email"; extra check in the app (test) |
| N3 | Ownership proof on a sub-path counted for the whole origin | Fixed: proof on the origin only (test) |
| N4 | Quadratic regexes on hostile HTML (/check and store scans) | Fixed: linear scans (lib/html-scan.ts); measured 37 s on 512 KB before, ms on 2 MB after (regression tests) |
| N5 | Direct REST insert skipped the plan's store limit | Fixed: trigger `stores_plan_limit_trigger` applied (20261101195735), checked in the DB: trigger present, not executable by authenticated |
| R2-1 | Spoofed bot visits could block the plugin's bot-hit uploads | Fixed in plugin 1.9.1: 400 KB batches, 120 bot rows a minute (PHP test) |
| R2-2 | Release-signing key usable from any branch | Fixed: main only, Environment "release", pinned actions |
| Hardening | Origin check on /api writes, self-heal re-check before put-back, atomic plugin nonces, no session from utm links alone, `npm ci`, Settings text on bot IPs, CDN and burst limits documented | Done (app deployed; plugin parts in 1.9.1) |
