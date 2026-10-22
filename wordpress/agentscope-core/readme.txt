=== AgentScope Core ===
Requires at least: 6.0
Requires PHP: 7.4
Stable tag: 1.2.0
License: GPLv2 or later

Read-only WooCommerce readiness checks and opt-in AI traffic signals.

== What it does ==
* Store Readiness: checks price (missing, zero, invalid, negative, sale not lower than regular), variable product prices, description length (heuristic), featured image, shipping weight, stock consistency, Shop/Cart/Checkout pages and policy pages. Never edits products.
* AI Traffic: when switched on in Settings, counts requests whose user agent or referrer names a known AI service. Daily totals only. No IP, no full user agent, no URL.
* AgentScope's own checks are not counted: requests with the X-AgentScope-Check header are skipped (see below).
* Connect to the AgentScope app (Settings): paste the connection code; the daily totals are sent once a day, signed with HMAC-SHA256. "Send now" sends immediately.
* Fix Center: each finding with evidence, guidance and a link to the product editor. Rescan to confirm.
* Reports: findings and traffic CSV with formula-injection protection, scan history (last 30 scans).
* AI Visibility: checked in the AgentScope app, shown as unavailable here.

== X-AgentScope-Check ==
AgentScope's access tests use AI bot user agents on purpose (GPTBot, ClaudeBot, ...). They carry this header:
* "v1.<unix seconds>.<hex HMAC-SHA256(connection token, "agentscope-check.<unix seconds>")>" when the store is connected. Accepted within 10 minutes.
* "1" when the store is not connected. Accepted only while this plugin has no connection token; once connected, only signed values are skipped, so nobody can hide requests from the totals by adding the header.

== Burst detection (heuristic) ==
SEO/GEO checker tools test a site by sending several AI bot user agents within seconds; real AI crawlers rarely arrive together. Within any 60 seconds:
* 3 or more different AI sources (for example OpenAI, Anthropic and Perplexity), or
* 5 or more AI bot requests using 3 or more different bot names (source + type),
are recorded with confidence "likely-checker-tool" instead of "unverified-user-agent", and the requests of the burst already counted are moved there too. They are shown apart and left out of the totals. This is a guess from timing only: a real crawler can be caught in a burst and a slow checker can be missed. Only the last 60 seconds of AI bot requests (source, type, route, status) are kept, in a transient.

== Limits ==
* User agents and referrers are unverified and can be spoofed.
* Requests served from a host or CDN cache never reach PHP and are not counted.
* No proof of AI recommendations, real customers or sales.

== REST (admins only) ==
GET  /wp-json/agentscope-core/v1/summary
POST /wp-json/agentscope-core/v1/scan
POST /wp-json/agentscope-core/v1/settings  (capture_enabled, retention_days, delete_on_uninstall)
GET  /wp-json/agentscope-core/v1/selftest

== Coexistence ==
Uses its own option names, table (agsc_traffic), classes (AGSC_*) and REST namespace, so it can run next to the older "AgentScope AI Traffic Monitor" plugin while you compare them.

== Changelog ==
= 1.2.0 =
* Burst detection: several AI bots within a minute are counted apart as "likely-checker-tool" (heuristic) and left out of the totals.
= 1.1.0 =
* AgentScope's own checks (X-AgentScope-Check header, signed with the connection token) are no longer counted as AI traffic.
* The app connection is built in: Settings → Connect to the AgentScope app (connection code, Connect, Send now, last send).
* Settings → Clear test data: sets the totals recorded before 1.1.0 to 0, after confirmation; when connected, the corrected days are sent to the app.
= 1.0.0 =
* Clean rebuild. Zero price now reported as its own finding. Paginated scan, scan history with new/ongoing/recurred/resolved states, Emerald admin workspace.
