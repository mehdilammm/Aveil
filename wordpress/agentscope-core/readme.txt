=== AgentScope Core ===
Contributors: agentscope
Tags: woocommerce, ai, chatgpt, structured data, analytics
Requires at least: 6.0
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.5.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Read-only WooCommerce readiness checks for AI shopping agents, and opt-in counts of AI bot and AI assistant traffic.

== Description ==

AgentScope Core checks whether your WooCommerce store gives AI shopping agents and assistants what they need, and counts the traffic they send. It never edits products.

* **Store Readiness:** price (missing, zero, invalid, negative, sale not lower than regular), variable product prices, description length (heuristic), featured image, shipping weight, stock consistency, Shop/Cart/Checkout pages and policy pages.
* **Fix Center:** each finding with evidence, guidance and a link to the product editor. Rescan to confirm.
* **AI Traffic (opt-in, off by default):** counts requests whose user agent or referrer names a known AI service (OpenAI, Anthropic, Perplexity, Google Gemini, Microsoft Copilot). Daily totals: no IP address, no full user agent, no page URL, no cookie (AI bot identity, below, is the only exception, for AI bot user agents only).
* **Checks and checker tools are kept apart:** requests from the AgentScope app carry an X-AgentScope-Check header and are not counted. Bursts of several AI bots within a minute are counted apart as "likely checker tool" (a heuristic).
* **AI referral on orders (opt-in, off by default):** when a visitor arrives from an AI assistant (ChatGPT, Perplexity, Gemini, Copilot, Claude and others, by referrer or utm_source), the AI source, how it was matched and the landing path are kept in the WooCommerce session and saved on the order (classic and block checkout, HPOS compatible). A fallback for WooCommerce Order Attribution. No IP, user agent, name or email. When the WP Consent API is active, nothing is stored without "statistics" consent.
* **Reports:** findings and traffic CSV with formula-injection protection, scan history (last 30 scans).
* **Optional connection to the AgentScope app:** sends the daily totals to your AgentScope account (see External services).

= AI bot identity (1.5.0) =

Only when traffic capture is on and the plugin is connected to the AgentScope app:

* The IP address is stored only for requests whose user agent is a known AI bot (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User). It is never stored for people. For those requests the plugin keeps: time, IP address, full user agent, page path (no query string), method and HTTP status. AgentScope's own checks and checker-tool bursts are not kept.
* These rows are sent to the AgentScope app in signed batches by WP-Cron (every 15 minutes), never during a page load, and deleted from your site after a successful send, or at the latest 7 days after the request if they could not be sent. Deactivating or deleting the plugin deletes them at once.
* The app checks each IP against the lists the bot operators publish (OpenAI, Anthropic, Perplexity, and Google's reverse DNS). If the IP is not in the official list, only "user agent only" is kept and the IP is deleted immediately, since it may be a person using a bot's name. Verified bot IPs are kept for at most 90 days.
* The IP is the one your web server sees (REMOTE_ADDR). Behind a CDN or proxy it is the proxy's address, so the request cannot be verified and is kept as "user agent only".

= Limits =

* User agents and referrers are unverified and can be spoofed.
* Requests served from a host or CDN cache never reach PHP and are not counted.
* No proof of AI recommendations, real customers or sales.

= X-AgentScope-Check =

AgentScope's access tests use AI bot user agents on purpose (GPTBot, ClaudeBot, ...). They carry this header:

* "v1.<unix seconds>.<hex HMAC-SHA256(connection token, "agentscope-check.<unix seconds>")>" when the store is connected. Accepted within 10 minutes.
* "1" when the store is not connected. Accepted only while this plugin has no connection token; once connected, only signed values are skipped, so nobody can hide requests from the totals by adding the header.

= Burst detection (heuristic) =

Within any 60 seconds, 3 or more different AI sources, or 5 or more AI bot requests using 3 or more different bot names, are recorded as "likely-checker-tool" instead of "unverified-user-agent", and the requests of the burst already counted are moved there too. They are shown apart and left out of the totals. This is a guess from timing only. Only the last 60 seconds of AI bot requests (source, type, route, status) are kept, in a transient.

== Installation ==

1. In WordPress go to Plugins → Add New → Upload Plugin, choose the zip and click Install Now.
2. Activate AgentScope Core.
3. Optional: in AgentScope → Settings, turn on "Record AI traffic signals".
4. Optional: in the AgentScope app, open Settings → AI traffic plugin, create a connection code, paste it in AgentScope → Settings → Connection token and click Connect.

== Frequently Asked Questions ==

= Does the plugin change my products? =

No. It only reads products, settings and pages.

= Does it collect personal data about my visitors? =

No. Traffic is stored as daily counts per AI source, type, page type and HTTP status. No IP address, user agent, page URL or cookie is stored or sent.

= Does the plugin read my orders? =

No. The optional AI-referral note only writes three fields on new orders (AI source, how it was matched, landing path). The AgentScope app can read recent orders through your WooCommerce API key to count AI-referred orders; it asks only for order id, date, total, currency, status, how the order was created and the attribution fields, never names, emails, phone numbers or addresses.

= Do I need an AgentScope account? =

No. Readiness checks and traffic counts work inside WordPress. The account is only needed to send the totals to the AgentScope app.

== External services ==

This plugin connects to the AgentScope app (https://agentscope-peach.vercel.app) in these cases only:

* **Sending AI bot hits** (1.5.0, only with traffic capture on and the app connected) — every 15 minutes from WP-Cron, to /api/ingest/bot-hits: for requests with a known AI bot user agent only, the time, IP address, full user agent, page path without query string, method and HTTP status, signed with the connection token. Never for people. Deleted locally after a successful send, or after 7 days at the latest. See "AI bot identity" above.
* **Sending traffic totals** — only after you paste a connection code and click Connect. Once a day, and when you click "Send now" or clear test data, it sends the daily totals of the last days: day, AI source, type, confidence, page type, HTTP status, number of requests and the time of the last request. It also sends your store ID and an HMAC signature made with the connection token. No IP address, user agent, page URL, cookie, customer or order data is sent.
* **Checking for plugin updates** (builds distributed from the AgentScope app only, not the WordPress.org build) — once a day from WP-Cron (never during a page load), a GET request to /api/plugin/latest that returns the latest version, its download link and SHA-256 checksum. It sends no store data and no token; the request's user agent is "AgentScope-Core/<version>". Like any web request, it reveals your server's IP address to the app's host.

The AgentScope app also sends requests *to* your store when you run a check there (with the X-AgentScope-Check header); this plugin does not count them.

Terms of Service: https://agentscope-peach.vercel.app/terms
Privacy Policy: https://agentscope-peach.vercel.app/privacy

== REST API (administrators only) ==

* GET /wp-json/agentscope-core/v1/summary
* POST /wp-json/agentscope-core/v1/scan
* POST /wp-json/agentscope-core/v1/settings (capture_enabled, retention_days, delete_on_uninstall)
* GET /wp-json/agentscope-core/v1/selftest

== Changelog ==

= 1.5.0 =
* AI bot identity: for known AI bot user agents only, the time, IP, full user agent, path, method and status are sent in signed batches from WP-Cron so the app can check the IP against the operators' published lists. Deleted locally after a successful send or after 7 days at the latest; never stored for people.

= 1.4.0 =
* Optional AI referral note on orders (session → order meta), classic and block checkout; HPOS and block checkout compatibility declared.
* No network call during any page load: the update check runs from WP-Cron, and "Connect" / "Send now" / clearing test data send in the background.

= 1.3.1 =
* Test release for the update checker: no functional change.

= 1.3.0 =
* Updates appear in WordPress like any plugin update, from the AgentScope app, checked once a day; the zip's SHA-256 is verified before it is installed.
* readme.txt follows the WordPress.org format, with an External services section.

= 1.2.1 =
* Clear test data can be repeated, and can clear one chosen day (UTC) as well as every day before 1.1.0, with the same confirmation.

= 1.2.0 =
* Burst detection: several AI bots within a minute are counted apart as "likely-checker-tool" (heuristic) and left out of the totals.

= 1.1.0 =
* AgentScope's own checks (X-AgentScope-Check header, signed with the connection token) are no longer counted as AI traffic.
* The app connection is built in: Settings → Connect to the AgentScope app.
* Settings → Clear test data.

= 1.0.0 =
* Clean rebuild: paginated scan, scan history, Emerald admin workspace.

== Upgrade Notice ==

= 1.5.0 =
Adds AI bot identity checks (AI bot user agents only; IPs deleted locally after sending or after 7 days).

= 1.4.0 =
Adds an optional AI referral note on orders, and moves all network calls to background tasks.

= 1.3.1 =
Test release for the update checker; nothing else changes.

= 1.3.0 =
Future updates show up in Plugins → Updates and are checked against a SHA-256 checksum.
