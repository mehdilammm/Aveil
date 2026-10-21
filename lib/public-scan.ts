// Public scan (no login, no API key): what any visitor or AI agent can see on a store's public pages.
// Pure functions only; the network and database parts are in public-scan-run.ts.
import { createHmac } from "node:crypto";
import { ACCESS_NOTE, checkAccess, type BotName, type PageResult } from "./access";
import { describePage, pageGate, type Gate } from "./gate";
import { detectProtection, ERROR_TITLE_RE, type Protection } from "./protection";
import { checkShopifyProducts, detectShopify, handleOf, SHOPIFY_LIST_NOTE, shopifyPricesByHandle, shopifyProductUrl } from "./shopify";
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
// Order matters: when the request limit is reached, the last ones are the ones not checked.
export const ACCESS_BOTS: BotName[] = ["GPTBot", "ClaudeBot", "PerplexityBot", "OAI-SearchBot"];
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

export const NOT_CHECKED = "not checked: request limit";

// A same-site redirect on the first request (example.com → www.example.com) gives the host to use for every later
// request, so redirects do not eat the request budget again and again.
export function learnCanonical(requested: string, final: string): { from: string; to: string } | null {
  try {
    const a = new URL(requested);
    const b = new URL(final);
    if (a.host === b.host || b.protocol !== "https:") return null;
    const strip = (h: string) => h.replace(/^www\./, "");
    return strip(a.hostname) === strip(b.hostname) ? { from: a.host, to: b.host } : null;
  } catch {
    return null;
  }
}

export function applyCanonical(url: string, canonical: { from: string; to: string } | null): string {
  if (!canonical) return url;
  try {
    const u = new URL(url);
    if (u.host !== canonical.from) return url;
    u.host = canonical.to;
    return u.toString();
  } catch {
    return url;
  }
}

export type RequestLogEntry = { step: string; outcome: string };

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
  const protection = detectProtection(fetch);
  if (protection) return { robots: null, status: "unavailable", detail: protection.reason };
  if (fetch.status >= 500) return { robots: { groups: [{ agents: ["*"], rules: [{ allow: false, pattern: "/" }] }], sitemaps: [] }, status: "server_error", detail: `HTTP ${fetch.status}` };
  if (fetch.status >= 400 || fetch.redirectedTo) return { robots: { groups: [], sitemaps: [] }, status: "missing", detail: `HTTP ${fetch.status}` };
  return { robots: parseRobots(fetch.body), status: "ok", detail: `HTTP ${fetch.status}` };
}

// ---------- page content ----------

export type Platform = { wordpress: boolean; woocommerce: boolean; shopify?: boolean };

export function platformName(p: Platform | null): "WooCommerce" | "Shopify" | "WordPress" | "unknown" {
  if (!p) return "unknown";
  if (p.shopify) return "Shopify";
  if (p.woocommerce) return "WooCommerce";
  return p.wordpress ? "WordPress" : "unknown";
}

export function detectPlatform(html: string, shopifyHeader = false): Platform {
  return {
    shopify: detectShopify(html, shopifyHeader),
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

export function sitemapProductUrls(xml: string, pageUrl: string, max = 2, platform: "woocommerce" | "shopify" = "woocommerce"): string[] {
  const base = new URL(pageUrl);
  const out: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const u = platform === "shopify" ? shopifyProductUrl(m[1], base) : sameHostProductUrl(m[1], base);
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

// Where the main product lives on the page (WooCommerce summary, Shopify product info / product form).
const MAIN_PRODUCT_RE = /class\s*=\s*["'][^"']*\b(entry-summary|summary|product__info-container|product__info-wrapper|product-single__meta|product__meta|product-info|product-form|wp-block-woocommerce-product-price)\b/i;
// Where other products start: related, recommended, upsell blocks.
const OTHER_PRODUCTS_RE = /class\s*=\s*["'][^"']*\b(related|upsells?|cross-sells?|product-recommendations|complementary-products|recently-viewed)\b|<product-recommendations|you may also like/i;
// Installment and pay-later texts ("from $29/mo", "4 payments of", Shop Pay, Affirm, Klarna, Afterpay, Sezzle).
const INSTALLMENT_BLOCK_RE = /<(shopify-payment-terms|afterpay-placement|klarna-placement|affirm-as-low-as)[\s\S]*?<\/\1>|<[a-z]+[^>]*class\s*=\s*["'][^"']*(installment|payment-terms|afterpay|klarna|affirm|sezzle|shop-pay)[^"']*["'][^>]*>[\s\S]*?<\/[a-z]+>/gi;
const INSTALLMENT_AFTER_RE = /^\s*(?:[a-z]{3})?\s*(\/\s*mo|\/\s*month|per month|a month|monthly|x\s*\d|with (affirm|klarna|afterpay|shop pay))/i;
const INSTALLMENT_BEFORE_RE = /(payments? of|installments? of|as low as|from|starting at)\s*[^\d\s]{0,4}\s*$/i;

function metaPrice(html: string): { amount: number | null; text: string | null } | null {
  const m =
    /<meta[^>]+property\s*=\s*["'](?:og|product):price:amount["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(html) ??
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["'](?:og|product):price:amount["']/i.exec(html);
  if (!m) return null;
  const amount = parseAmount(m[1]);
  return amount === null ? null : { amount, text: m[1].trim() };
}

// First real price number in a piece of text: not a monthly / installment amount.
function firstPrice(text: string): string | null {
  for (const m of text.matchAll(/\d[\d.,\u00a0\u202f ]*\d|\d/g)) {
    const before = text.slice(Math.max(0, m.index! - 25), m.index);
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 25);
    if (INSTALLMENT_AFTER_RE.test(after) || INSTALLMENT_BEFORE_RE.test(before)) continue;
    return m[0].trim();
  }
  return null;
}

export type VisiblePrice = { amount: number | null; text: string | null; source: "price block" | "meta" | null };

// The price shown for the page's main product, from the product area only (never related products or
// installment texts); falls back to og:price:amount / product:price:amount. Unknown when not sure.
export function visiblePrice(html: string): VisiblePrice {
  const start = html.search(MAIN_PRODUCT_RE);
  if (start >= 0) {
    let region = html.slice(start, start + 20_000);
    // Cut where other products start (skip the opening tag of the main area itself).
    const skip = region.indexOf(">") + 1;
    const other = region.slice(skip).search(OTHER_PRODUCTS_RE);
    if (other >= 0) region = region.slice(0, other + skip);
    region = region.replace(INSTALLMENT_BLOCK_RE, " ");
    const rel = region.search(/class\s*=\s*["'][^"']*\b(price|price-item|woocommerce-Price-amount|wc-block-components-product-price)\b/i);
    if (rel >= 0) {
      let segment = region.slice(rel, rel + 3000);
      const ins = /<ins[^>]*>([\s\S]*?)<\/ins>/i.exec(segment);
      const shopifyItem =
        /class\s*=\s*["'][^"']*price-item--sale[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(segment) ??
        /class\s*=\s*["'][^"']*price-item--regular[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(segment);
      if (ins) segment = ins[1];
      else if (shopifyItem) segment = shopifyItem[1];
      const amountStart = segment.search(/woocommerce-Price-amount/i);
      if (amountStart >= 0) segment = segment.slice(amountStart);
      const text = segment
        .replace(/<span[^>]*woocommerce-Price-currencySymbol[^>]*>[\s\S]*?<\/span>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/^[^>]*>/, " ")
        .replace(/&nbsp;|&#160;/g, " ");
      const n = firstPrice(text);
      const amount = n === null ? null : parseAmount(n);
      if (amount !== null) return { amount, text: n, source: "price block" };
    }
  }
  const meta = metaPrice(html);
  return meta ? { ...meta, source: "meta" } : { amount: null, text: null, source: null };
}

export type PriceCheck = "match" | "mismatch" | "unknown";

export function priceConsistency(schemaPrice: string | null, visible: number | null): PriceCheck {
  const s = schemaPrice === null ? NaN : Number(schemaPrice.replace(",", "."));
  if (!Number.isFinite(s) || visible === null || !Number.isFinite(visible)) return "unknown";
  return Math.abs(s - visible) <= 0.01 ? "match" : "mismatch";
}

// ---------- report ----------

export type GeminiPart =
  | {
      status: "ok";
      engine?: "gemini" | "mistral";
      model: string;
      prompt: string;
      answer: string;
      mentioned: boolean;
      competitors: string[];
      method: "model" | "heuristic" | "failed";
      extractionError?: string;
      extractor?: "gemini" | "mistral" | null;
    }
  | { status: "unavailable"; reason: string; prompt: string; engine?: "gemini" | "mistral" };

// Two Gemini questions per domain:
// visibility: a general question about what the store sells, without its name. "Mentioned" there is the real signal.
// knowledge: "Does Gemini know this store?", asked by domain. Its answer names the store by construction, so it is
// shown for information and never counted as visibility.
export type GeminiParts = { visibility: GeminiPart; knowledge: GeminiPart; visibilityMistral?: GeminiPart };

export const GEMINI_DISCLAIMER = "This is what the AI model says. Facts like prices, warranties or history were not verified by AgentScope.";

const SLUG_RE = /\/(?:product-category|collections|category|shop\/category)\/([a-z0-9-]{3,40})\/?["'?#]/gi;
const STOP_SLUGS = new Set(["uncategorized", "uncategorised", "all", "sale", "new", "featured", "frontpage", "home", "shop", "products", "blog", "news"]);

function stripBrand(text: string, brandKeys: string[]): string {
  return text
    .split(/\s+/)
    .filter((w) => {
      const k = w.toLowerCase().replace(/[^a-z0-9]/g, "");
      return k && !brandKeys.some((b) => k === b || (b.length >= 5 && k.includes(b)));
    })
    .join(" ");
}

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&#\d+;/g, " ");
}

// What the store sells, in a few words, from the home page and without the store's name:
// product category links first, then the meta description, then the title.
export function topicFromHome(html: string, brandKeys: string[]): string | null {
  const counts = new Map<string, number>();
  for (const m of html.matchAll(SLUG_RE)) {
    const slug = m[1].toLowerCase();
    if (STOP_SLUGS.has(slug)) continue;
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const slugs = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([slug]) => stripBrand(slug.replace(/-/g, " "), brandKeys)).filter(Boolean).slice(0, 3);
  if (slugs.length) return slugs.join(", ");

  const meta =
    /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']{10,400})["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']{10,400})["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i.exec(html)?.[1];
  const title = /<title[^>]*>([^<]{3,200})<\/title>/i.exec(html)?.[1];
  for (const source of [meta, title]) {
    if (!source || ERROR_TITLE_RE.test(source)) continue;
    const clause = decode(source).split(/[.!?|–—]|\s-\s/)[0];
    const words = stripBrand(clause, brandKeys).replace(/^(welcome to|shop|buy|discover|the|at|from)\s+/i, "").replace(/^(is|are)\s+((an?|the)\s+)?/i, "").trim().split(/\s+/).slice(0, 12).join(" ");
    if (words.split(/\s+/).length >= 2) return words.replace(/[,:;]+$/, "");
  }
  return null;
}

export function visibilityQuestion(topic: string): string {
  return `Which online stores would you recommend for ${topic}?`;
}

export function knowledgeQuestion(host: string): string {
  return `What do you know about the online store ${host}? Which similar stores would you recommend?`;
}

export type PublicPage = {
  url: string;
  kind: "home" | "product";
  seen: string;
  schema: SchemaProduct | null;
  visiblePrice: string | null;
  priceCheck: PriceCheck;
  // What the JSON-LD price was compared with: the store's product list (Shopify /products.json) or the page.
  comparedWith?: "store product list" | "price on the page" | null;
  storePrice?: string | null;
};

export type PublicReport = {
  version: 2;
  url: string;
  host: string;
  checkedAt: string;
  requests: number;
  requestLimit?: number;
  requestLog?: RequestLogEntry[];
  platform: Platform | null;
  platformName?: ReturnType<typeof platformName>;
  shopifyList?: { status: "ok"; checked: number; note: string } | { status: "unavailable"; reason: string } | null;
  gate: Gate | null;
  protection?: Protection | null;
  agentScopeBlocked: boolean;
  robots: { status: string; detail: string; verdicts: RobotsVerdict[]; sitemaps: string[] };
  llmsTxt: "present" | "missing" | "unavailable";
  accessTested: boolean;
  accessResults: { bot: string; seen: string }[];
  productSource: "home page links" | "sitemap" | "products.json" | "none";
  pages: PublicPage[];
  gemini: GeminiParts;
  findings: (Finding & { area: string })[];
};

export type PublicScanInput = {
  url: string; // https://host/
  host: string;
  checkedAt: string;
  requests: number;
  requestLog?: RequestLogEntry[];
  robots: PageFetch | null;
  llms: PageFetch | null;
  home: PageFetch | null;
  bots: Partial<Record<BotName, PageFetch>>;
  products: { url: string; fetch: PageFetch }[];
  productSource: PublicReport["productSource"];
  shopifyProducts?: PageFetch | null; // /products.json, Shopify only
  gemini: GeminiParts;
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
  const llmsTxt: PublicReport["llmsTxt"] = !input.llms || !input.llms.ok || detectProtection(input.llms)
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
  const protection = detectProtection(home);
  const homeOk = Boolean(home?.ok && !home.redirectedTo && home.status >= 200 && home.status < 400);
  const platform = home?.ok && homeOk && !protection ? detectPlatform(home.body, home.shopifyHeader) : null;
  const gate = home && !protection ? pageGate(home) : null;
  if (protection) {
    findings.push(f("access", "protection:blocked", {
      type: "bot_protection_blocked",
      title: `Bot protection blocked our automated check (${protection.vendor})`,
      severity: "medium",
      basis: "heuristic",
      evidence: `Home page: HTTP ${protection.status}${protection.title ? `, title "${protection.title}"` : ""}, ${Math.max(1, Math.round(protection.bytes / 1024))} KB. Our request used the AgentScopeBot user agent.`,
      guidance: "AI shopping agents may be blocked the same way. Check your bot protection settings (e.g. Cloudflare Bot Fight Mode, Verified Bots) and allow the AI agents you want.",
    }));
    findings.push(f("store_pages", "protection:unavailable", {
      title: "Platform, product pages, structured data and bot access could not be checked",
      severity: "low",
      basis: "unavailable",
      evidence: `The home page was a bot protection page (${protection.vendor}), not the store.`,
      guidance: "Allow AgentScopeBot (or verified bots) in your bot protection to get the full public check.",
    }));
  }
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
  if (platform?.shopify) {
    findings.push(f("store_pages", "platform:shopify", { title: "Shopify store detected", severity: "low", basis: "observed", evidence: "The home page loads Shopify assets (cdn.shopify.com, Shopify.theme or Shopify headers).", guidance: "The checks below apply to Shopify too. The full scan with a store key is for WooCommerce for now." }));
  }

  // Shopify: the public product list (/products.json), first 10 products only.
  let shopifyList: PublicReport["shopifyList"] = null;
  if (platform?.shopify && input.shopifyProducts !== undefined) {
    const sp = input.shopifyProducts;
    const spProtection = detectProtection(sp);
    const result = !sp
      ? { status: "unavailable" as const, reason: "not requested (request limit or robots.txt)" }
      : !sp.ok
        ? { status: "unavailable" as const, reason: sp.error }
        : spProtection
          ? { status: "unavailable" as const, reason: spProtection.reason }
          : sp.status !== 200
            ? { status: "unavailable" as const, reason: `HTTP ${sp.status}` }
            : checkShopifyProducts(sp.body, input.url.replace(/\/$/, ""));
    if (result.status === "ok") {
      shopifyList = { status: "ok", checked: result.checked, note: SHOPIFY_LIST_NOTE };
      findings.push(...result.findings.map((x) => ({ ...x, area: "product_data" })));
    } else if (sp && !sp.ok && sp.skipped) {
      shopifyList = { status: "unavailable", reason: NOT_CHECKED };
      findings.push(f("product_data", "shopify:not_checked", { title: `Shopify product list ${NOT_CHECKED}`, severity: "low", basis: "unavailable", evidence: `/products.json: ${NOT_CHECKED}.`, guidance: "Nothing to fix. It was not read this time." }));
    } else {
      shopifyList = { status: "unavailable", reason: result.reason };
      findings.push(f("product_data", "shopify:list_unavailable", { title: "Shopify product list not available (not a problem)", severity: "low", basis: "unavailable", evidence: `/products.json: ${result.reason}. Many stores turn it off; product data was checked on product pages only.`, guidance: "Nothing to do. The product pages below were still checked." }));
    }
  }

  // Bot access: one request per bot on the home page, compared with our normal request.
  let accessTested = false;
  const notChecked = Object.entries(input.bots).filter(([, r]) => r && !r.ok && r.skipped).map(([bot]) => bot);
  const checkedBots = Object.fromEntries(Object.entries(input.bots).filter(([bot]) => !notChecked.includes(bot)));
  if (notChecked.length) {
    findings.push(f("access", "access:not_checked", { title: `Bot access ${NOT_CHECKED}`, severity: "low", basis: "unavailable", evidence: `${notChecked.join(", ")}: ${NOT_CHECKED} for this free check.`, guidance: "Nothing to fix. These bots were not tested this time." }));
  }
  if (home && !agentScopeBlocked && !protection) {
    const page: PageResult = { label: "home page", url: input.url, browser: home, bots: checkedBots, gate: gate?.reason };
    accessTested = !gate && Object.keys(checkedBots).length > 0;
    findings.push(...checkAccess(input.url, [page], { baseline: "our normal request (AgentScopeBot)", retried: false }).map((x) => ({ ...x, area: "access" })));
  }

  // Product pages: JSON-LD and price consistency.
  const pages: PublicPage[] = [];
  if (home?.ok) {
    const { products } = extractSchemaProducts(home.body);
    pages.push({ url: input.url, kind: "home", seen: describePage(home), schema: products[0] ?? null, visiblePrice: null, priceCheck: "unknown" });
  }
  if (!agentScopeBlocked && !gate && !protection && homeOk && input.products.length === 0) {
    findings.push(f("structured_data", "schema:no_product_pages", { title: "Could not find product pages to check", severity: "low", basis: "unavailable", evidence: "The home page links no product page (/product/… or /products/…) and the product list or sitemap gave none.", guidance: "Link a few products from the home page, or make sure the product sitemap is public (WordPress: /wp-sitemap.xml, Shopify: /sitemap.xml)." }));
  }
  const sp = input.shopifyProducts;
  const storePrices = sp?.ok && sp.status === 200 ? shopifyPricesByHandle(sp.body) : new Map<string, number>();
  input.products.forEach((p, i) => {
    const key = `product${i + 1}`;
    const pp = detectProtection(p.fetch);
    const pg = p.fetch.ok && !pp ? pageGate(p.fetch) : null;
    if (!p.fetch.ok || p.fetch.status < 200 || p.fetch.status >= 300 || pg || pp) {
      findings.push(f("structured_data", `schema:unavailable:${key}`, { title: "Could not check a product page", severity: "low", basis: "unavailable", evidence: `${p.url}: ${pp ? pp.reason : pg ? pg.reason : describePage(p.fetch)}.`, guidance: pp ? "Allow AgentScopeBot or verified bots in your bot protection." : "Check that the product page loads for visitors." }));
      pages.push({ url: p.url, kind: "product", seen: describePage(p.fetch), schema: null, visiblePrice: null, priceCheck: "unknown" });
      return;
    }
    const schema = extractSchemaProducts(p.fetch.body).products[0] ?? null;
    const visible = visiblePrice(p.fetch.body);
    // Shopify: the product list price for the same handle is the reference when available.
    const handle = handleOf(p.url);
    const listPrice = handle ? storePrices.get(handle) ?? null : null;
    const comparedWith = listPrice !== null ? "store product list" : visible.amount !== null ? "price on the page" : null;
    const check = priceConsistency(schema?.readable ? schema.price : null, listPrice ?? visible.amount);
    pages.push({ url: p.url, kind: "product", seen: describePage(p.fetch), schema, visiblePrice: visible.text, priceCheck: check, comparedWith, storePrice: listPrice === null ? null : String(listPrice) });
    if (!schema) {
      findings.push(f("structured_data", `schema:missing:${key}`, { type: "schema_product_missing", title: "No Product structured data", severity: "medium", basis: "observed", evidence: `${p.url} has no JSON-LD Product. Page: ${describePage(p.fetch)}.`, guidance: "WooCommerce and Shopify themes add Product structured data by default. Check that your theme, SEO app/plugin or cache does not remove it, then check again." }));
      return;
    }
    if (!schema.readable) {
      findings.push(f("structured_data", `schema:unparsed:${key}`, { type: "schema_unparsed", title: "Product structured data found but could not be read", severity: "low", basis: "unavailable", evidence: `${p.url} has a JSON-LD ${schema.kind}, but this check could not read its name, price, currency, availability or image.`, guidance: "Nothing to fix for now: this is a limit of the check, not necessarily of your page." }));
      return;
    }
    const missing = [!schema.name && "name", !schema.price && "price", !schema.currency && "priceCurrency", !schema.availability && "availability", !schema.image && "image"].filter(Boolean);
    if (missing.length) {
      findings.push(f("structured_data", `schema:fields:${key}`, { type: "schema_fields_missing", title: "Product structured data is incomplete", severity: "medium", basis: "observed", evidence: `The JSON-LD ${schema.kind} on ${p.url} has no ${missing.join(", ")}.`, guidance: "Set the product's price, stock and image in WooCommerce or Shopify admin; if they are set, the theme or SEO app/plugin writing the structured data is dropping them." }));
    }
    if (check === "mismatch") {
      const other = comparedWith === "store product list" ? `the store's product list (/products.json) says ${listPrice}` : `the page shows ${visible.text}`;
      findings.push(f("structured_data", `price:mismatch:${key}`, { type: "price_mismatch", title: comparedWith === "store product list" ? "Price in structured data differs from the store's product price" : "Price in structured data differs from the price on the page", severity: "high", basis: "observed", evidence: `On ${p.url}, structured data says ${schema.price}${schema.currency ? ` ${schema.currency}` : ""}; ${other}.`, guidance: "AI agents may quote the wrong price. Clear your page cache, check sale price dates in the product, and check the theme or plugin that writes structured data (taxes shown on the page vs. in the data can also differ). Then check again." }));
    }
  });

  const mis = input.gemini.visibilityMistral;
  if (mis?.status === "ok" && !mis.mentioned) {
    findings.push(f("ai_visibility", "mistral:not_named", {
      title: "Mistral did not name this store for its category",
      severity: "low",
      basis: "observed",
      evidence: `Asked "${mis.prompt}", the Mistral API answer did not name ${input.host}${mis.competitors.length ? `; it named ${mis.competitors.slice(0, 5).join(", ")}` : ""}. One answer, without web search.`,
      guidance: "Same as for Gemini: readable product pages, complete product data, and being listed where your category is reviewed.",
    }));
  }
  const vis = input.gemini.visibility;
  if (vis.status === "unavailable") {
    findings.push(f("ai_visibility", "gemini:unavailable", { title: "Gemini visibility check not run", severity: "low", basis: "unavailable", evidence: vis.reason, guidance: "Try again tomorrow." }));
  } else if (!vis.mentioned) {
    findings.push(f("ai_visibility", "gemini:not_named", {
      title: "Gemini did not name this store for its category",
      severity: "low",
      basis: "observed",
      evidence: `Asked "${vis.prompt}", the Gemini API answer did not name ${input.host}${vis.competitors.length ? `; it named ${vis.competitors.slice(0, 5).join(", ")}` : ""}. One answer, without web search.`,
      guidance: "AI answers draw on what is published about your store. Make sure product pages are readable by AI bots (see above), complete product data in WooCommerce (descriptions, brand, GTIN), and get listed on sites that review or list shops in your category.",
    }));
  }

  return {
    version: 2,
    url: input.url,
    host: input.host,
    checkedAt: input.checkedAt,
    requests: input.requests,
    requestLimit: LIMITS.httpRequests,
    requestLog: input.requestLog ?? [],
    platform,
    platformName: platformName(platform),
    shopifyList,
    gate,
    protection,
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

// The home page can describe the store only when it is the real page: 2xx, not a protection, error or placeholder page.
export function trustedHomeHtml(home: PageFetch | null): string | null {
  if (!home || !home.ok || home.redirectedTo || home.status < 200 || home.status >= 300) return null;
  if (detectProtection(home) || pageGate(home)) return null;
  return home.body;
}
