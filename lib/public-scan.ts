// Public scan (no login, no API key): what any visitor or AI agent can see on a store's public pages.
// Pure functions only; the network and database parts are in public-scan-run.ts.
import { createHmac } from "node:crypto";
import { ACCESS_NOTE, checkAccess, type BotName, type PageResult } from "./access";
import { describePage, pageGate, type Gate } from "./gate";
import type { Source } from "./pages";
import { isAllowed, parseRobots, type Robots } from "./robots";
import type { Finding, Severity } from "./rules";
import { extractSchemaProducts, type SchemaProduct } from "./structured-data";
import type { PageFetch } from "./woo";

export const PUBLIC_UA = "AgentScopeBot/1.0 (+https://agentscope-peach.vercel.app/bot)";
export const PUBLIC_UA_TOKEN = "AgentScopeBot";
export const CHECK_HEADER = "X-AgentScope-Check";

export const LIMITS = {
  httpRequests: 10,
  gapMs: 1500,
  timeoutMs: 10_000,
  maxBytes: 2 * 1024 * 1024,
  redirects: 3,
  scansPerHourPerIp: 5,
  geminiPerDay: 50,
  cacheHours: 24,
  reportDays: 30,
} as const;

export const ROBOTS_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "PerplexityBot", "Google-Extended"] as const;
export const ACCESS_BOTS: BotName[] = ["GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot"];
export const GEMINI_LABEL = "Gemini API answer, not the Gemini app";

// What blocking each bot costs a store. Google-Extended only controls use by Google's AI models, not Search.
const ROBOTS_SEVERITY: Record<(typeof ROBOTS_BOTS)[number], Severity> = {
  "ChatGPT-User": "high",
  "OAI-SearchBot": "high",
  PerplexityBot: "high",
  GPTBot: "medium",
  ClaudeBot: "medium",
  "Google-Extended": "medium",
};

// ---------- visitors, cache, limits ----------

// HMAC of the IP with a server secret and the UTC day: enough for an hourly rate limit, not reversible,
// and not linkable across days. The full IP is never stored.
export function hashIp(ip: string, secret: string, now: Date): string {
  return createHmac("sha256", secret).update(`${now.toISOString().slice(0, 10)}|${ip.trim()}`).digest("hex");
}

export function clientIp(headers: Headers): string {
  return (headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || headers.get("x-real-ip")?.trim() || "unknown";
}

export const withinRateLimit = (countInWindow: number) => countInWindow <= LIMITS.scansPerHourPerIp;

export function isFresh(createdAt: string, now: Date, hours: number = LIMITS.cacheHours): boolean {
  return now.getTime() - Date.parse(createdAt) < hours * 3_600_000;
}

// Gemini runs at most once per domain per 24 h (the daily app-wide cap is checked in the database).
export function geminiAllowedForDomain(lastGeminiAt: string | null, now: Date): boolean {
  return !lastGeminiAt || !isFresh(lastGeminiAt, now);
}

// ---------- robots.txt ----------

export type RobotsVerdict = {
  bot: string;
  verdict: "allowed" | "blocked" | "not mentioned";
  effective: "allowed" | "blocked"; // what applies, including the * group
};

function names(robots: Robots, bot: string): boolean {
  return robots.groups.some((g) => g.agents.includes(bot.toLowerCase()));
}

export function robotsVerdicts(robots: Robots, path = "/"): RobotsVerdict[] {
  return ROBOTS_BOTS.map((bot) => {
    const effective = isAllowed(robots, bot, path) ? "allowed" : "blocked";
    return { bot, verdict: names(robots, bot) ? effective : "not mentioned", effective };
  });
}

export function agentScopeAllowed(robots: Robots | null, path: string): boolean {
  return !robots || isAllowed(robots, PUBLIC_UA_TOKEN, path);
}

// robots.txt answer → rules. 4xx means no rules; 5xx means "do not crawl" (RFC 9309); unreadable means unknown.
export function robotsFrom(fetch: PageFetch | null): { robots: Robots | null; status: "ok" | "missing" | "server_error" | "unavailable"; detail: string } {
  if (!fetch || !fetch.ok) return { robots: null, status: "unavailable", detail: fetch && !fetch.ok ? fetch.error : "not loaded" };
  if (fetch.status >= 500) return { robots: { groups: [{ agents: ["*"], rules: [{ allow: false, pattern: "/" }] }], sitemaps: [] }, status: "server_error", detail: `HTTP ${fetch.status}` };
  if (fetch.status >= 400 || fetch.redirectedTo) return { robots: { groups: [], sitemaps: [] }, status: "missing", detail: `HTTP ${fetch.status}` };
  return { robots: parseRobots(fetch.body), status: "ok", detail: `HTTP ${fetch.status}` };
}

// ---------- page content ----------

export function detectPlatform(html: string): { wordpress: boolean; woocommerce: boolean } {
  return {
    wordpress: /\/wp-content\/|\/wp-includes\/|<meta[^>]+name=["']generator["'][^>]+WordPress/i.test(html),
    woocommerce: /\/wp-content\/plugins\/woocommerce\/|class=["'][^"']*\bwoocommerce\b|wc-block-|<meta[^>]+name=["']generator["'][^>]+WooCommerce/i.test(html),
  };
}

const PRODUCT_PATH_RE = /\/product\/[^/?#]+\/?$/i;

function sameHostProductUrl(raw: string, base: URL): string | null {
  try {
    const u = new URL(raw.replace(/&amp;/g, "&"), base);
    if (u.protocol !== "https:" || u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) return null;
    if (u.searchParams.has("add-to-cart")) return null;
    if (PRODUCT_PATH_RE.test(u.pathname) || u.searchParams.has("product")) {
      u.hash = "";
      return u.toString();
    }
  } catch {
    // not a URL
  }
  return null;
}

// Up to two product pages linked from the home page.
export function productLinks(html: string, pageUrl: string, max = 2): string[] {
  const base = new URL(pageUrl);
  const out: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#][^"']*)["']/gi)) {
    const u = sameHostProductUrl(m[1], base);
    if (u && !out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

// Which product sitemap to read when the home page links no product (one request only).
export function productSitemapUrl(robotsSitemaps: string[], origin: string): string {
  const host = new URL(origin).hostname.replace(/^www\./, "");
  const own = robotsSitemaps.filter((s) => {
    try {
      return new URL(s).hostname.replace(/^www\./, "") === host;
    } catch {
      return false;
    }
  });
  const product = own.find((s) => /product/i.test(s));
  if (product) return product;
  if (own.some((s) => /sitemap_index\.xml/i.test(s))) return `${origin}/product-sitemap.xml`;
  return `${origin}/wp-sitemap-posts-product-1.xml`;
}

export function sitemapProductUrls(xml: string, pageUrl: string, max = 2): string[] {
  const base = new URL(pageUrl);
  const out: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const u = sameHostProductUrl(m[1], base);
    if (u && !out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

// "1.234,56", "1,234.56", "75,00", "390.00", "1 234,50" → number. Three digits after the last separator = thousands.
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/&nbsp;|&#160;| | |\s|'/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  if (last === -1) return Number(s);
  const after = s.length - last - 1;
  if (after === 3) return Number(s.replace(/[.,]/g, ""));
  return Number(`${s.slice(0, last).replace(/[.,]/g, "")}.${s.slice(last + 1)}`);
}

const PRICE_BLOCK_RE = /class\s*=\s*["'][^"']*\b(price|wc-block-components-product-price|wp-block-woocommerce-product-price)\b[^"']*["']/i;

// The price a visitor sees on a product page: the main WooCommerce price block, the sale price when there is one.
export function visiblePrice(html: string): { amount: number | null; text: string | null } {
  const summary = html.search(/class\s*=\s*["'][^"']*\b(summary|entry-summary|wp-block-woocommerce-product-price)\b/i);
  const from = summary >= 0 ? summary : 0;
  const rel = html.slice(from).search(PRICE_BLOCK_RE);
  if (rel < 0) return { amount: null, text: null };
  let segment = html.slice(from + rel, from + rel + 3000);
  const ins = /<ins[^>]*>([\s\S]*?)<\/ins>/i.exec(segment);
  if (ins) segment = ins[1];
  const amountStart = segment.search(/woocommerce-Price-amount/i);
  if (amountStart >= 0) segment = segment.slice(amountStart);
  const text = segment
    .replace(/<span[^>]*woocommerce-Price-currencySymbol[^>]*>[\s\S]*?<\/span>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/^[^>]*>/, " ");
  const num = /\d[\d.,   ]*\d|\d/.exec(text.replace(/&nbsp;|&#160;/g, " "));
  if (!num) return { amount: null, text: null };
  return { amount: parseAmount(num[0]), text: num[0].trim() };
}

export type PriceCheck = "match" | "mismatch" | "unknown";

export function priceConsistency(schemaPrice: string | null, visible: number | null): PriceCheck {
  const s = schemaPrice === null ? NaN : Number(schemaPrice.replace(",", "."));
  if (!Number.isFinite(s) || visible === null || !Number.isFinite(visible)) return "unknown";
  return Math.abs(s - visible) <= 0.01 ? "match" : "mismatch";
}

// ---------- report ----------

export type GeminiPart =
  | { status: "ok"; model: string; prompt: string; answer: string; mentioned: boolean; competitors: string[]; method: "model" | "heuristic" }
  | { status: "unavailable"; reason: string; prompt: string };

export type PublicPage = {
  url: string;
  kind: "home" | "product";
  seen: string;
  schema: SchemaProduct | null;
  visiblePrice: string | null;
  priceCheck: PriceCheck;
};

export type PublicReport = {
  version: 1;
  url: string;
  host: string;
  checkedAt: string;
  requests: number;
  platform: { wordpress: boolean; woocommerce: boolean } | null;
  gate: Gate | null;
  agentScopeBlocked: boolean;
  robots: { status: string; detail: string; verdicts: RobotsVerdict[]; sitemaps: string[] };
  llmsTxt: "present" | "missing" | "unavailable";
  accessTested: boolean;
  accessResults: { bot: string; seen: string }[];
  productSource: "home page links" | "sitemap" | "none";
  pages: PublicPage[];
  gemini: GeminiPart;
  findings: (Finding & { area: string })[];
};

export type PublicScanInput = {
  url: string; // https://host/
  host: string;
  checkedAt: string;
  requests: number;
  robots: PageFetch | null;
  llms: PageFetch | null;
  home: PageFetch | null;
  bots: Partial<Record<BotName, PageFetch>>;
  products: { url: string; fetch: PageFetch }[];
  productSource: PublicReport["productSource"];
  gemini: GeminiPart;
};

type F = Finding & { area: string };

function f(area: string, key: string, x: Omit<Finding, "finding_key" | "product_id" | "type"> & { type?: string }): F {
  return { area, finding_key: key, type: x.type ?? key.split(":")[0], product_id: null, ...x };
}

export function buildPublicReport(input: PublicScanInput): PublicReport {
  const findings: F[] = [];
  const { robots, status: robotsStatus, detail: robotsDetail } = robotsFrom(input.robots);
  const robotsUrl = `${input.url.replace(/\/$/, "")}/robots.txt`;
  const verdicts = robots ? robotsVerdicts(robots) : [];
  const agentScopeBlocked = !agentScopeAllowed(robots, "/");

  // robots.txt
  if (robotsStatus === "unavailable") {
    findings.push(f("robots", "robots:unavailable", { title: "Could not read robots.txt", severity: "low", basis: "unavailable", evidence: `${robotsUrl}: ${robotsDetail}.`, guidance: "Open robots.txt in a browser to check it. WordPress serves one by default." }));
  } else if (robotsStatus === "server_error") {
    findings.push(f("robots", "robots:server_error", { title: "robots.txt returns a server error", severity: "high", basis: "observed", evidence: `${robotsUrl} answered ${robotsDetail}. Crawlers that follow RFC 9309 then crawl nothing.`, guidance: "Fix the error so robots.txt loads (check your host, cache or security plugin), then check again." }));
  }
  for (const v of verdicts) {
    if (v.effective !== "blocked" || robotsStatus === "server_error") continue;
    findings.push(f("robots", `robots:${v.bot}`, {
      type: "robots_blocks_bot",
      title: `robots.txt blocks ${v.bot}`,
      severity: ROBOTS_SEVERITY[v.bot as (typeof ROBOTS_BOTS)[number]],
      basis: "observed",
      evidence: v.verdict === "not mentioned" ? `${v.bot} is not named, and the rules for all bots (User-agent: *) block the home page.` : `The ${v.bot} group in ${robotsUrl} blocks the home page.`,
      guidance: `If this is not on purpose: in WordPress, open your SEO plugin's robots.txt editor (Yoast: Tools → File editor; Rank Math: General Settings → Edit robots.txt) or the robots.txt file on your host, and remove the Disallow rule for ${v.bot} (or for *).`,
    }));
  }
  if (robots && robotsStatus !== "server_error" && robots.sitemaps.length === 0) {
    findings.push(f("robots", "robots:no_sitemap", { title: "robots.txt does not list a sitemap", severity: "low", basis: "observed", evidence: robotsStatus === "missing" ? `${robotsUrl} does not exist (${robotsDetail}).` : `${robotsUrl} has no Sitemap: line.`, guidance: "Add a line like \"Sitemap: https://your-store/wp-sitemap.xml\". WordPress and SEO plugins (Yoast, Rank Math) can add it for you." }));
  }

  // llms.txt
  const llmsTxt: PublicReport["llmsTxt"] = !input.llms || !input.llms.ok
    ? "unavailable"
    : input.llms.status >= 200 && input.llms.status < 300 && !input.llms.redirectedTo && input.llms.body.trim() && !/^\s*<(!doctype|html)/i.test(input.llms.body)
      ? "present"
      : "missing";
  if (llmsTxt === "missing") {
    findings.push(f("structured_data", "llms_txt:missing", { title: "No llms.txt (information only)", severity: "low", basis: "observed", evidence: `${input.url}llms.txt was not found.`, guidance: "Optional. llms.txt is an informal proposal for a short text guide to your site; no major AI shopping agent requires it today." }));
  }

  // Pages were not loaded at all when robots.txt asks AgentScopeBot to stay out.
  if (agentScopeBlocked) {
    findings.push(f("access", "agentscope:blocked", {
      title: "robots.txt asks AgentScopeBot not to crawl, so pages were not checked",
      severity: "low",
      basis: "unavailable",
      evidence: `${robotsUrl} disallows the home page for ${PUBLIC_UA_TOKEN} (or for all bots). Only robots.txt was read.`,
      guidance: "This is your choice and is respected. To allow this check, add \"User-agent: AgentScopeBot\" with \"Allow: /\" to robots.txt.",
    }));
  }

  const home = input.home;
  const platform = home?.ok ? detectPlatform(home.body) : null;
  const gate = home ? pageGate(home) : null;
  if (gate) {
    findings.push(f("store_pages", "page:store_gate", {
      type: gate.kind === "maintenance" ? "store_maintenance_mode" : "store_coming_soon",
      title: gate.kind === "maintenance" ? "Store is in maintenance mode" : "Store is in Coming soon mode",
      severity: "low",
      basis: "observed",
      evidence: `On the home page, ${gate.reason}. Bot access and structured data could not be checked.`,
      guidance: gate.kind === "maintenance" ? "Turn off maintenance mode when the store is ready, then check again." : "When the store is ready: WooCommerce → Settings → Site visibility → Live, then check again.",
    }));
  }
  if (platform && !platform.woocommerce) {
    findings.push(f("store_pages", "platform:not_woocommerce", { title: "WooCommerce not detected", severity: "low", basis: "heuristic", evidence: `No WooCommerce markers in the home page HTML (${platform.wordpress ? "WordPress was detected" : "WordPress was not detected"}).`, guidance: "The full AgentScope scan works with WooCommerce stores. Other checks on this page still apply." }));
  }

  // Bot access: one request per bot on the home page, compared with our normal request.
  let accessTested = false;
  if (home && !agentScopeBlocked) {
    const page: PageResult = { label: "home page", url: input.url, browser: home, bots: input.bots, gate: gate?.reason };
    accessTested = !gate && Object.keys(input.bots).length > 0;
    findings.push(...checkAccess(input.url, [page], { baseline: "our normal request (AgentScopeBot)", retried: false }).map((x) => ({ ...x, area: "access" })));
  }

  // Product pages: JSON-LD and price consistency.
  const pages: PublicPage[] = [];
  if (home?.ok) {
    const { products } = extractSchemaProducts(home.body);
    pages.push({ url: input.url, kind: "home", seen: describePage(home), schema: products[0] ?? null, visiblePrice: null, priceCheck: "unknown" });
  }
  if (!agentScopeBlocked && !gate && home?.ok && input.products.length === 0) {
    findings.push(f("structured_data", "schema:no_product_pages", { title: "Could not find product pages to check", severity: "low", basis: "unavailable", evidence: "The home page links no /product/ page and the product sitemap gave none.", guidance: "Link a few products from the home page, or make sure the product sitemap is public (WordPress: /wp-sitemap.xml)." }));
  }
  input.products.forEach((p, i) => {
    const key = `product${i + 1}`;
    const pg = p.fetch.ok ? pageGate(p.fetch) : null;
    if (!p.fetch.ok || p.fetch.status < 200 || p.fetch.status >= 300 || pg) {
      findings.push(f("structured_data", `schema:unavailable:${key}`, { title: "Could not check a product page", severity: "low", basis: "unavailable", evidence: `${p.url}: ${pg ? pg.reason : describePage(p.fetch)}.`, guidance: "Check that the product page loads for visitors." }));
      pages.push({ url: p.url, kind: "product", seen: describePage(p.fetch), schema: null, visiblePrice: null, priceCheck: "unknown" });
      return;
    }
    const schema = extractSchemaProducts(p.fetch.body).products[0] ?? null;
    const visible = visiblePrice(p.fetch.body);
    const check = priceConsistency(schema?.price ?? null, visible.amount);
    pages.push({ url: p.url, kind: "product", seen: describePage(p.fetch), schema, visiblePrice: visible.text, priceCheck: check });
    if (!schema) {
      findings.push(f("structured_data", `schema:missing:${key}`, { type: "schema_product_missing", title: "No Product structured data", severity: "medium", basis: "observed", evidence: `${p.url} has no JSON-LD Product. Page: ${describePage(p.fetch)}.`, guidance: "WooCommerce adds Product structured data by default. Check that your theme, SEO plugin or cache plugin does not remove it, then check again." }));
      return;
    }
    const missing = [!schema.name && "name", !schema.price && "price", !schema.currency && "priceCurrency", !schema.availability && "availability", !schema.image && "image"].filter(Boolean);
    if (missing.length) {
      findings.push(f("structured_data", `schema:fields:${key}`, { type: "schema_fields_missing", title: "Product structured data is incomplete", severity: "medium", basis: "observed", evidence: `The JSON-LD Product on ${p.url} has no ${missing.join(", ")}.`, guidance: "In WooCommerce, set the product's price, stock status and product image; if they are set, the SEO plugin writing the structured data is dropping them." }));
    }
    if (check === "mismatch") {
      findings.push(f("structured_data", `price:mismatch:${key}`, { type: "price_mismatch", title: "Price in structured data differs from the price on the page", severity: "high", basis: "observed", evidence: `On ${p.url}, structured data says ${schema.price}${schema.currency ? ` ${schema.currency}` : ""}; the page shows ${visible.text}.`, guidance: "AI agents may quote the wrong price. Clear your page cache, check sale price dates in the product, and check the plugin that writes structured data (taxes shown on the page vs. in the data can also differ). Then check again." }));
    }
  });

  if (input.gemini.status === "unavailable") {
    findings.push(f("ai_visibility", "gemini:unavailable", { title: "Gemini check not run", severity: "low", basis: "unavailable", evidence: input.gemini.reason, guidance: "Try again tomorrow." }));
  }

  return {
    version: 1,
    url: input.url,
    host: input.host,
    checkedAt: input.checkedAt,
    requests: input.requests,
    platform,
    gate,
    agentScopeBlocked,
    robots: { status: robotsStatus, detail: robotsDetail, verdicts, sitemaps: robots?.sitemaps ?? [] },
    llmsTxt,
    accessTested,
    accessResults: Object.entries(input.bots).map(([bot, r]) => ({ bot, seen: describePage(r!) })),
    productSource: input.productSource,
    pages,
    gemini: input.gemini,
    findings,
  };
}

export { ACCESS_NOTE };
