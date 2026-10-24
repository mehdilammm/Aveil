# AgentScope — Master Prompt (with current overrides)

Talk to me in Moroccan Darija, short. I am on my phone.

## Overrides (read first, they win over everything below)

- Do NOT restart from M0. Most of it is already shipped (Milestones A–D in EXECUTION_PLAN.md: orders + funnel,
  adapter, jobs + pg_cron, bot IP verification, i18n skeleton, market prompts, product impact, fix queue,
  generators, auto-fix with write key + FixAuditLog + undo, verify loop, plugin 1.6.0).
- Reconcile first: map every item to EXECUTION_PLAN.md as Done / Partial / Missing, list only the gaps, then STOP
  and show the gap list.
- Record `APPROVED: <item> — <date>` lines for what was already approved. Anything new needs approval.
- Providers: Gemini free tier (ungrounded) stays allowed and is labeled "Ungrounded model answer". Grounded/paid
  providers (OpenAI, Anthropic, Perplexity, Gemini grounding) are built behind flags and stay off until the cost is
  approved. Features that need them (citations, competitor gap) show `Unavailable: needs a grounded engine`.
- Jobs: keep the existing Postgres queue + pg_cron. No Inngest.
- Shopify app and Turnstile: wait until the Shopify Partner and Cloudflare accounts exist. The Shopify public check
  stays as it is.
- Tenant model: keep workspaces / workspace_members as the tenant. Add isolation tests if missing.
- Priority for the gaps:
  1. Data export + hard delete for the workspace owner.
  2. Tenant isolation tests.
  3. Safe shareable report.
  4. Arabic clause templates for impact sentences.
  5. Visibility outcome track (7/14/30 days).
  6. /check → full scan conversion.
- After each gap: commit, push, update EXECUTION_PLAN.md, and report in Darija what works, what was actually tested
  in production (DB before/after), and what is next.

The earlier rules still apply (EXECUTION_PLAN.md header and ARCHITECTURE.md): data honesty (Observed / Heuristic /
Unavailable with the reason, no invented values), merchant safety (read-only by default, writes only with the
write key or the signed plugin after approval, undo), one hardened fetcher, privacy rules for bot IPs, free tiers
only until a cost is approved, verification gate after each part.

## Competitive update (verified on WordPress.org, Oct 2026)

- AgenticTrack (WooCommerce plugin): free audit with a 0–100 score per product, all manual fixes free (schema,
  price, category, description, GTIN/SKU), free robots.txt + product-aware llms.txt, preview + one-click undo, bulk
  fixes, bulk SKU/GTIN CSV import, free 7-day AI sales. Pro = AI rewrites + agent-order analytics.
- AgentCart (WooCommerce + Shopify): UCP protocol so agents can browse and check out. Complementary.
- Mention Network: AI visibility for e-commerce (ChatGPT, Gemini, Claude, AI Mode), first check free.
- Never copy their code or texts. No competitor names on the site.

## Gaps after G6

- G7 Plans: Free = full readiness audit + all manual / one-click / input fixes for 1 store (never weaker than the
  free tools above). Pro = multi-store, weekly scans, AI visibility, verified bot traffic, AI-referred orders +
  funnel + "why agents aren't buying", auto-fix, reports. Agency = workspaces + team + client reports. Propose
  plans.ts and /pricing changes, then STOP and wait for the APPROVED line.
- G8 Bulk fixes: bulk apply for one-click fixes + bulk GTIN/SKU/weight CSV import, with preview, audit log and undo.
- G9 New finding: detect UCP / ACP / agentic checkout support (manifest, feed, or plugins like AgentCart). Info
  only, badged.
- G10 Landing (en + ar): hero "See why AI shopping agents skip your WooCommerce products. Fix without breaking the
  store. Prove it with real AI-referred orders." Edge line "Others give you a score. We show why AI agents don't
  buy, fix it, and prove it with real orders." Points: multi-store for agencies, verified AI bot traffic, free check
  on any store, no magic score.

Reporting: two lines after each part; the long report after G6 and after G10.

## Approvals on record

- APPROVED: workspaces / workspace_members as the tenant — 2026-10-22
- APPROVED: Gemini free tier (ungrounded, labeled "Ungrounded model answer") — 2026-10-22
- APPROVED: Groq / NVIDIA helper models for internal tasks (name extraction, question suggestions) — 2026-10-22
- APPROVED: ai_orders + order_syncs (AI-referred orders, no personal data) — 2026-10-23
- APPROVED: jobs + job_steps + pg_cron / pg_net tick with the secret header — 2026-10-23
- APPROVED: bot_hits + official IP lists (IP only for AI bot user agents; unverified IPs deleted at once; verified kept ≤ 90 days; plugin deletes after send or ≤ 7 days) — 2026-10-23
- APPROVED: write key + Auto-fix + FixAuditLog + undo (preview and one approval; plugin 1.6.0 signed fixes) — 2026-10-23
- APPROVED: moving pg_net to the extensions schema — 2026-10-23 (pending: must be done from the Supabase dashboard)
- APPROVED: G7 plans — Free $0 (1 store, full readiness audit monthly, full Fix Center: manual + one-click + input + CSV, funnel without orders, 3 AI visibility questions per month, CSV export), Pro $29 (3 stores, weekly scans, auto-fix, 25 visibility questions/week, verified bot traffic, AI orders + full funnel + why agents aren't buying, share links + weekly report), Agency $49 (10 stores, everything in Pro + workspaces, team, client reports). Prices unchanged. Locked features show "Unavailable: needs Pro plan" with an Upgrade button (waitlist for now). matha.site workspace stays a pro test override — 2026-10-24

## Reconciliation (2026-10-23)

| Item | Status | Where / what is missing |
| --- | --- | --- |
| Milestones A–D (orders, funnel, adapter, jobs, bot verification, i18n skeleton, market prompts, product impact, fix queue, generators, auto-fix, verify loop, plugin 1.6.0) | Done | EXECUTION_PLAN.md A1–A6, B0–B9, C1–C2, C4, D1–D5 |
| Providers behind flags, citations / competitor gap Unavailable | Partial | Gemini grounding is behind `GEMINI_GROUNDING_ENABLED`; OpenAI / Anthropic / Perplexity adapters are not built yet; C3 not started |
| Jobs on Postgres + pg_cron | Done | B9 |
| Shopify app, Turnstile | Waiting (accounts) | Milestone E |
| Tenant isolation tests | Missing | RLS policies exist (`private.store_role`, `private.ws_role`), no test proves a member of workspace A cannot read workspace B |
| Data export + hard delete for the workspace owner | Missing | Only "delete store" exists (cascade); no export of a workspace's data, no workspace / account hard delete |
| Safe shareable report | Partial | Public /check reports have a share link; no shareable report for a store's own scan (token, expiry, revoke, no private data) |
| Arabic clause templates for impact sentences | Missing | Product Impact clauses are English strings in `lib/product-impact.ts` |
| Visibility outcome track (7/14/30 days) | Partial | Re-check runs are scheduled after a verified fix (D5); no view comparing the answers before the fix and at day 7 / 14 / 30 |
| /check → full scan conversion | Partial | The /check report links to sign-up; the checked store's URL is not carried into "add store", and no first scan starts by itself |
| pg_net in the extensions schema | Pending (dashboard) | DROP hangs past the SQL tool limit; jobs tick still 200 |
