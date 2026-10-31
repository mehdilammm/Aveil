# Milestone H — UI audit (before any change)

Live site agentscope-peach.vercel.app, 2026-10-31, demo account (workspace "Demo Store", Pro, copy of matha.site
data). 16 pages × phone 390 px / desktop 1440 px × English / Arabic = 64 screenshots in `audit/before/`
(full pages) and `audit/crops/` (first screen, contact sheets). Numbers from the page itself (Playwright).

Demo limits (data, not UI): no WooCommerce key on the demo store, so Product Impact, Bots × products and Checkout by
market show "Unavailable"; the /check report shown is the latest public check (temu.com).

## Everywhere (layout)

| Level | Problem | Where it shows |
|---|---|---|
| Critical | Phone: the green header (logo, store name, scrolling tabs, Log out, language) takes ~160 px of 844 on every page; tabs are cut ("Store Rea…") and 13 items scroll sideways | top-*-mobile-*.png |
| Critical | Arabic: most dashboard text stays English (Overview cards, Fix Center tools, Store Readiness, AI Visibility, AI Revenue, AI Traffic, Reports, Settings, /check, login form, page titles); mixed EN text in RTL puts the full stop first (".Every scan…") and breaks dates ("Oct 2026, 22:17 UTC 28") | sheet-mobile-ar.png |
| Major | Desktop: the green sidebar stops at the first screen height (cream below when scrolling); content column ~900 px with empty space on the right on most pages | top-overview-desktop-en.png, sheet-desktop-en.png |
| Major | Menu order: AI Traffic and Bots × products come before Fix Center; Fix Center (where the work is) is 5th | sidebar |
| Major | Tap targets under 44 px: 13–94 per page (tabs, links, "Verify fix", "Remove", "Undo", "Dismiss") | metrics.json |
| Minor | Browser tab title is the same generic text on 12 of 16 pages | metrics.json |
| Minor | Language switch shows the other language as a small underlined link; current one not marked as a control | header |

## Per page

**Overview** (overview-*)
- Major: no "next best action"; first screen is a plugin tip + last scan + 5 area cards; "Top 5 to fix" starts below the first screen (phone ~1,500 px down).
- Major: each area card shows 3 count badges incl. zeros ("0 CRITICAL 0 WARNING 0 LOW").
- Minor: area text is technical ("robots.txt, JSON-LD Product data and llms.txt").

**Fix Center** (fix-center-*) — the worst page
- Critical: phone page is 16,245 px long, 38 cards, ~3,000 words; findings start after 5 tool cards (rescan, generators, bot-block guide, auto-fix, alt text).
- Critical: phone width 413 px > 390: the audit log table overflows sideways (horizontal scroll).
- Major: 4 badges per card (severity · basis · state · area) + "Priority 2 = impact 4 × confidence 1 ÷ effort 2" + resolved line + "Verify fix" on every card; 132 badges on the page.
- Major: evidence is technical first (URLs, HTTP codes, ".well-known/acp.json", "shippingNone").
- Minor: "Open in WordPress", "Market row · Last purchase test" are small text links.

**Store Readiness** (readiness-*)
- Major: phone table of 20 scans with 8 columns; only 4 fit, the rest is cut (no card layout).
- Minor: "Details" links 20 × small.

**Product Impact** (impact-*), **Bots × products** (bots-*)
- Minor (UI): the empty state is a single line with an "UNAVAILABLE" badge; no next step button (e.g. add the key).

**AI Visibility** (visibility-*)
- Major: 8,000 px on phone; usage meter, engine notes and 7 questions with "Remove" each come before any result.
- Major: the explanation box is long technical text (models, grounding) in the first screen.
- Minor: "NOT RECORDED" badge on every question.

**AI Revenue** (revenue-*)
- Major: page has hard-coded English (title, funnel, "Why agents aren't buying"); not translated.
- Minor: funnel steps use 3 badges each (status, OK/PROBLEM, OBSERVED).

**AI Traffic** (traffic-*)
- Major: tables (source / category / confidence) cut on phone; "unverified-user-agent" raw values.
- Minor: long caveat paragraph first.

**Checkout by market** (markets-*)
- Major: purchase test timeline: 9 steps each with a badge and raw codes / HTTP lines; two tests one after the other.
- Minor: table on phone not readable when the key is set (4 columns).

**Alerts** (alerts-*)
- Minor: long intro paragraph; each alert card has 3 lines of status text.

**Reports** (reports-*)
- Major: weekly report lists 26 fixed + 10 new items in full ("Feed: brand missing" × 15) with no grouping.
- Minor: not translated.

**Settings** (settings-*)
- Minor: add-store form fields full width with hints in small grey; store actions are small disclosure triangles.

**Landing** (landing-*), **Pricing** (pricing-*)
- Minor: good overall; on phone the hero is 5 lines at 28 px; pricing cards stack fine. Pricing waitlist inputs below 44 px.

**/check** and report (check-*, check-report-*)
- Major: not translated (stays English in Arabic).
- Minor: report on phone 5,183 px; each finding 3 badges.
