import { describe, expect, it } from "vitest";
import {
  agentScopeAllowed, buildPublicReport, knowledgeQuestion, topicFromHome, visibilityQuestion, geminiAllowedForDomain, hashIp, isFresh, parseAmount, priceConsistency, productLinks,
  productSitemapUrl, robotsVerdicts, sitemapProductUrls, visiblePrice, withinRateLimit, type PublicScanInput,
} from "./public-scan";
import { isAllowed, parseRobots } from "./robots";
import { assertPublicAddresses, normalizeStoreUrl } from "./url";
import type { PageFetch } from "./woo";

const page = (status: number, body: string, extra: Partial<Extract<PageFetch, { ok: true }>> = {}): PageFetch => ({
  ok: true, status, finalUrl: "https://shop.test/", redirectedTo: null, bytes: body.length, body, challengeHeader: false, ...extra,
});

// Trimmed WooCommerce single product page (classic theme): sale price and Product JSON-LD.
const productHtml = (schemaPrice: string, visible = "390,00") => `<!doctype html><html><head><title>Brass Lantern – Shop</title>
<script type="application/ld+json">{"@context":"https://schema.org/","@type":"Product","name":"Brass Lantern","image":"https://shop.test/l.jpg",
"offers":[{"@type":"Offer","price":"${schemaPrice}","priceCurrency":"MAD","availability":"http://schema.org/InStock"}]}</script></head>
<body class="product-template-default single-product woocommerce"><div class="summary entry-summary"><h1>Brass Lantern</h1>
<p class="price"><del aria-hidden="true"><span class="woocommerce-Price-amount amount"><bdi>450,00&nbsp;<span class="woocommerce-Price-currencySymbol">&#x62f;.&#x645;.</span></bdi></span></del>
<ins><span class="woocommerce-Price-amount amount"><bdi>${visible}&nbsp;<span class="woocommerce-Price-currencySymbol">&#x62f;.&#x645;.</span></bdi></span></ins></p></div>
<section class="related products"><span class="price"><span class="woocommerce-Price-amount amount"><bdi>75,00</bdi></span></span></section></body></html>`;

const homeHtml = `<html><head><title>Shop</title><link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/css/woocommerce.css"></head>
<body class="home woocommerce-js"><a href="/product/brass-lantern/">Lantern</a><a href="https://shop.test/product/mint-tea/?add-to-cart=12">Add</a>
<a href="https://shop.test/product/mint-tea/">Tea</a><a href="https://other.test/product/x/">x</a>${"<p>text</p>".repeat(800)}</body></html>`;

describe("robots.txt", () => {
  const r = parseRobots(`User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php

User-agent: GPTBot
User-agent: ClaudeBot
Disallow: /

User-agent: PerplexityBot
Allow: /product/
Disallow: /*?*
Disallow: /*.pdf$

Sitemap: https://shop.test/wp-sitemap.xml`);

  it("reads groups, wildcards, $ and Allow/Disallow", () => {
    expect(isAllowed(r, "GPTBot", "/")).toBe(false);
    expect(isAllowed(r, "claudebot", "/product/x/")).toBe(false);
    expect(isAllowed(r, "PerplexityBot", "/product/x/")).toBe(true);
    expect(isAllowed(r, "PerplexityBot", "/shop/?orderby=price")).toBe(false);
    expect(isAllowed(r, "PerplexityBot", "/a.pdf")).toBe(false);
    expect(isAllowed(r, "PerplexityBot", "/a.pdfx")).toBe(true);
    expect(isAllowed(r, "OAI-SearchBot", "/wp-admin/admin-ajax.php")).toBe(true);
    expect(isAllowed(r, "OAI-SearchBot", "/wp-admin/")).toBe(false);
  });

  it("gives allowed / blocked / not mentioned per AI bot", () => {
    const v = Object.fromEntries(robotsVerdicts(r).map((x) => [x.bot, `${x.verdict}/${x.effective}`]));
    expect(v).toEqual({
      GPTBot: "blocked/blocked",
      "OAI-SearchBot": "not mentioned/allowed",
      "ChatGPT-User": "not mentioned/allowed",
      ClaudeBot: "blocked/blocked",
      PerplexityBot: "allowed/allowed",
      "Google-Extended": "not mentioned/allowed",
    });
  });

  it("respects a block on AgentScopeBot", () => {
    expect(agentScopeAllowed(r, "/")).toBe(true);
    expect(agentScopeAllowed(parseRobots("User-agent: AgentScopeBot\nDisallow: /"), "/")).toBe(false);
    expect(agentScopeAllowed(parseRobots("User-agent: *\nDisallow: /"), "/")).toBe(false);
    expect(agentScopeAllowed(null, "/")).toBe(true);
  });
});

describe("price consistency", () => {
  it("parses prices in common formats", () => {
    expect(parseAmount("390,00")).toBe(390);
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("1 234,50")).toBe(1234.5);
    expect(parseAmount("1,234")).toBe(1234);
    expect(parseAmount("12,5")).toBe(12.5);
    expect(parseAmount("abc")).toBeNull();
  });

  it("reads the sale price from the main price block, not related products", () => {
    expect(visiblePrice(productHtml("390.00"))).toEqual({ amount: 390, text: "390,00" });
    expect(visiblePrice("<html><body>no price</body></html>").amount).toBeNull();
  });

  it("compares JSON-LD and visible price", () => {
    expect(priceConsistency("390.00", 390)).toBe("match");
    expect(priceConsistency("450.00", 390)).toBe("mismatch");
    expect(priceConsistency(null, 390)).toBe("unknown");
    expect(priceConsistency("390", null)).toBe("unknown");
  });
});

describe("finding product pages", () => {
  it("takes same-host /product/ links, skips add-to-cart and other hosts", () => {
    expect(productLinks(homeHtml, "https://shop.test/")).toEqual(["https://shop.test/product/brass-lantern/", "https://shop.test/product/mint-tea/"]);
  });

  it("picks the product sitemap", () => {
    expect(productSitemapUrl(["https://shop.test/wp-sitemap.xml"], "https://shop.test")).toBe("https://shop.test/wp-sitemap-posts-product-1.xml");
    expect(productSitemapUrl(["https://shop.test/sitemap_index.xml"], "https://shop.test")).toBe("https://shop.test/product-sitemap.xml");
    expect(productSitemapUrl(["https://shop.test/product-sitemap.xml"], "https://shop.test")).toBe("https://shop.test/product-sitemap.xml");
    expect(productSitemapUrl(["https://evil.test/product.xml"], "https://shop.test")).toBe("https://shop.test/wp-sitemap-posts-product-1.xml");
    expect(sitemapProductUrls("<urlset><url><loc>https://shop.test/product/a/</loc></url><url><loc>https://shop.test/product/b/</loc></url><url><loc>https://shop.test/product/c/</loc></url></urlset>", "https://shop.test/"))
      .toEqual(["https://shop.test/product/a/", "https://shop.test/product/b/"]);
  });
});

describe("rate limit, cache and Gemini limit", () => {
  const now = new Date("2026-10-21T10:00:00Z");
  it("hashes IPs per day without keeping them", () => {
    const a = hashIp("203.0.113.5", "secret", now);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("203");
    expect(hashIp("203.0.113.5", "secret", now)).toBe(a);
    expect(hashIp("203.0.113.5", "secret", new Date("2026-10-22T10:00:00Z"))).not.toBe(a);
    expect(hashIp("203.0.113.6", "secret", now)).not.toBe(a);
  });

  it("allows 5 scans per hour per visitor", () => {
    expect(withinRateLimit(5)).toBe(true);
    expect(withinRateLimit(6)).toBe(false);
  });

  it("reuses a report for 24 hours", () => {
    expect(isFresh("2026-10-20T10:30:00Z", now)).toBe(true);
    expect(isFresh("2026-10-20T09:59:00Z", now)).toBe(false);
  });

  it("asks Gemini at most once per domain per 24 hours", () => {
    expect(geminiAllowedForDomain(null, now)).toBe(true);
    expect(geminiAllowedForDomain("2026-10-21T01:00:00Z", now)).toBe(false);
    expect(geminiAllowedForDomain("2026-10-20T09:00:00Z", now)).toBe(true);
  });
});

describe("SSRF guards", () => {
  it("only accepts public https store URLs", () => {
    for (const bad of ["http://shop.test", "https://127.0.0.1", "https://169.254.169.254", "https://[fd00::1]", "https://metadata.google.internal", "https://localhost"]) {
      expect(normalizeStoreUrl(bad)).toHaveProperty("error");
    }
  });

  it("refuses DNS answers with any private, loopback or metadata address", () => {
    expect(assertPublicAddresses([{ address: "93.184.216.34" }])).toBeNull();
    expect(assertPublicAddresses([{ address: "93.184.216.34" }, { address: "10.0.0.5" }])).toContain("10.0.0.5");
    expect(assertPublicAddresses([{ address: "169.254.169.254" }])).not.toBeNull();
    expect(assertPublicAddresses([{ address: "::1" }])).not.toBeNull();
    expect(assertPublicAddresses([])).not.toBeNull();
  });
});

describe("buildPublicReport", () => {
  const base = (over: Partial<PublicScanInput> = {}): PublicScanInput => ({
    url: "https://shop.test/",
    host: "shop.test",
    checkedAt: "2026-10-21T10:00:00Z",
    requests: 9,
    robots: page(200, "User-agent: *\nDisallow: /wp-admin/\n\nSitemap: https://shop.test/wp-sitemap.xml"),
    llms: page(404, "not found"),
    home: page(200, homeHtml),
    bots: { GPTBot: page(200, homeHtml), "OAI-SearchBot": page(200, homeHtml), ClaudeBot: page(200, homeHtml), PerplexityBot: page(200, homeHtml) },
    products: [{ url: "https://shop.test/product/brass-lantern/", fetch: page(200, productHtml("390.00")) }],
    productSource: "home page links",
    gemini: { visibility: { status: "unavailable", reason: "daily limit reached", prompt: "q" }, knowledge: { status: "unavailable", reason: "daily limit reached", prompt: "k" } },
    ...over,
  });
  const keys = (i: PublicScanInput) => buildPublicReport(i).findings.map((x) => `${x.finding_key}/${x.severity}/${x.basis}`);

  it("a healthy WooCommerce store only gets the information notes", () => {
    const r = buildPublicReport(base());
    expect(r.platform).toEqual({ wordpress: true, woocommerce: true });
    expect(r.pages.find((p) => p.kind === "product")?.priceCheck).toBe("match");
    expect(keys(base())).toEqual(["llms_txt:missing/low/observed", "gemini:unavailable/low/unavailable"]);
  });

  it("403 for a bot is HIGH blocked, 429 is MEDIUM rate-limited", () => {
    const k = keys(base({ bots: { GPTBot: page(403, "Forbidden"), ClaudeBot: page(429, "slow down"), "OAI-SearchBot": page(200, homeHtml), PerplexityBot: page(200, homeHtml) } }));
    expect(k).toContain("access:GPTBot/high/heuristic");
    expect(k).toContain("access:ClaudeBot/medium/heuristic");
    const r = buildPublicReport(base({ bots: { ClaudeBot: page(429, "x") } }));
    expect(r.findings.find((x) => x.finding_key === "access:ClaudeBot")?.evidence).not.toContain("retry");
  });

  it("flags a JSON-LD price that differs from the page as HIGH", () => {
    expect(keys(base({ products: [{ url: "https://shop.test/product/brass-lantern/", fetch: page(200, productHtml("450.00")) }] }))).toContain("price:mismatch:product1/high/observed");
  });

  it("robots.txt blocks per bot and a blocked AgentScopeBot stops page checks", () => {
    expect(keys(base({ robots: page(200, "User-agent: OAI-SearchBot\nDisallow: /\nSitemap: https://shop.test/s.xml") }))).toContain("robots:OAI-SearchBot/high/observed");
    const r = buildPublicReport(base({ robots: page(200, "User-agent: AgentScopeBot\nDisallow: /\nSitemap: https://shop.test/s.xml"), home: null, bots: {}, products: [] }));
    expect(r.agentScopeBlocked).toBe(true);
    expect(r.findings.map((x) => x.finding_key)).toEqual(["llms_txt:missing", "agentscope:blocked", "gemini:unavailable"]);
  });

  it("a Coming soon store gets one note and no false access or schema findings", () => {
    const soon = `<html><head><title>Shop</title></head><body><div class="wp-block-woocommerce-coming-soon woocommerce-coming-soon-entire-site">Soon</div></body></html>`;
    const r = buildPublicReport(base({ home: page(200, soon), bots: {}, products: [] }));
    expect(r.gate?.kind).toBe("coming_soon");
    expect(r.findings.map((x) => `${x.finding_key}/${x.basis}`)).toEqual([
      "llms_txt:missing/observed",
      "page:store_gate/observed",
      "access:baseline:home page/unavailable",
      "gemini:unavailable/unavailable",
    ]);
  });
});

describe("Gemini questions", () => {
  it("builds the general question from category links, without the store name", () => {
    const html = `<a href="https://badeloft.com/product-category/bathtubs/">Bathtubs</a><a href="/product-category/bathtubs/">x</a>
      <a href="/product-category/vanities/">Vanities</a><a href="/product-category/uncategorized/">u</a><a href="/product-category/badeloft-specials/">s</a>`;
    const topic = topicFromHome(html, ["badeloft"]);
    expect(topic).toBe("bathtubs, vanities, specials");
    expect(visibilityQuestion(topic!)).toBe("Which online stores would you recommend for bathtubs, vanities, specials?");
  });

  it("falls back to the meta description with the brand removed", () => {
    const html = `<title>Kinfolk</title><meta name="description" content="Kinfolk is a slow lifestyle magazine and shop for home, design and travel. Since 2011.">`;
    const topic = topicFromHome(html, ["kinfolk"]);
    expect(topic).toBe("slow lifestyle magazine and shop for home, design and travel");
    expect(topic).not.toMatch(/kinfolk/i);
    expect(topicFromHome("<title>Kinfolk</title>", ["kinfolk"])).toBeNull();
  });

  it("keeps the knowledge question separate", () => {
    expect(knowledgeQuestion("kinfolk.com")).toBe("What do you know about the online store kinfolk.com? Which similar stores would you recommend?");
  });

  it("reports 'not named' only from the general question", () => {
    const input = (mentioned: boolean) => ({
      url: "https://shop.test/", host: "shop.test", checkedAt: "2026-10-21T10:00:00Z", requests: 3,
      robots: null, llms: null, home: null, bots: {}, products: [], productSource: "none" as const,
      gemini: {
        visibility: { status: "ok" as const, model: "m", prompt: "Which online stores would you recommend for tea?", answer: "a", mentioned, competitors: ["Etsy"], method: "model" as const },
        knowledge: { status: "ok" as const, model: "m", prompt: "k", answer: "shop.test is…", mentioned: true, competitors: [], method: "model" as const },
      },
    });
    expect(buildPublicReport(input(false)).findings.map((x) => x.finding_key)).toContain("gemini:not_named");
    expect(buildPublicReport(input(true)).findings.map((x) => x.finding_key)).not.toContain("gemini:not_named");
  });
});
