import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPublicReport, detectPlatform, platformName, priceConsistency, sitemapProductUrls, visiblePrice, type PublicScanInput } from "./public-scan";
import { extractSchemaProducts } from "./structured-data";
import { checkShopifyProducts, detectShopify, SHOPIFY_LIST_NOTE, shopifyProductLinks, shopifyProductSitemap } from "./shopify";
import type { PageFetch } from "./woo";

// Shopify fixtures written for these tests (Dawn theme markup and the public /products.json shape); not recorded from a store.
const fx = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const home = fx("shopify-home.html");
const product = fx("shopify-product.html");
const productsJson = fx("shopify-products.json");

const page = (status: number, body: string, extra: Partial<Extract<PageFetch, { ok: true }>> = {}): PageFetch => ({
  ok: true, status, finalUrl: "https://badeloft.com/", redirectedTo: null, bytes: body.length, body, challengeHeader: false, ...extra,
});

describe("Shopify detection and product links", () => {
  it("detects Shopify from the page or headers", () => {
    expect(detectShopify(home)).toBe(true);
    expect(detectShopify("<html>plain</html>", true)).toBe(true);
    expect(detectShopify("<html><link href='/wp-content/plugins/woocommerce/x.css'></html>")).toBe(false);
    expect(platformName(detectPlatform(home))).toBe("Shopify");
    expect(platformName(detectPlatform("<html><link href='/wp-content/plugins/woocommerce/x.css'></html>"))).toBe("WooCommerce");
    expect(platformName(detectPlatform("<html><link href='/wp-content/themes/x.css'></html>"))).toBe("WordPress");
    expect(platformName(null)).toBe("unknown");
  });

  it("finds /products/<handle> links, also under collections, without duplicates or cart links", () => {
    expect(shopifyProductLinks(home, "https://badeloft.com/")).toEqual([
      "https://badeloft.com/products/bw-01-l-freestanding-bathtub",
      "https://badeloft.com/products/bw-04-oval-bathtub",
    ]);
  });

  it("finds the products sitemap in the Shopify sitemap index", () => {
    const index = `<sitemapindex><sitemap><loc>https://badeloft.com/sitemap_products_1.xml?from=1&amp;to=99</loc></sitemap><sitemap><loc>https://badeloft.com/sitemap_pages_1.xml</loc></sitemap></sitemapindex>`;
    expect(shopifyProductSitemap(index, "https://badeloft.com/")).toBe("https://badeloft.com/sitemap_products_1.xml?from=1&to=99");
    const map = `<urlset><url><loc>https://badeloft.com/</loc></url><url><loc>https://badeloft.com/products/a</loc></url><url><loc>https://badeloft.com/products/b</loc></url></urlset>`;
    expect(sitemapProductUrls(map, "https://badeloft.com/", 2, "shopify")).toEqual(["https://badeloft.com/products/a", "https://badeloft.com/products/b"]);
  });
});

describe("Shopify product page", () => {
  it("reads JSON-LD and the sale price shown (not the struck regular price or related products)", () => {
    const schema = extractSchemaProducts(product).products[0];
    expect(schema).toMatchObject({ name: "BW-01 Freestanding Bathtub", price: "1099", currency: "USD", image: true });
    const visible = visiblePrice(product);
    expect(visible.amount).toBe(1099);
    expect(priceConsistency(schema.price, visible.amount)).toBe("match");
  });
});

describe("/products.json", () => {
  const result = checkShopifyProducts(productsJson, "https://badeloft.com");

  it("checks the products and reports each rule", () => {
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.checked).toBe(5);
    expect(result.findings.map((f) => `${f.finding_key}/${f.severity}/${f.basis}`)).toEqual([
      "shopify:price_zero:1002/medium/observed",
      "shopify:compare_at_not_higher:1003/medium/observed",
      "shopify:no_images:1004/medium/observed",
      "shopify:short_description:1004/low/heuristic",
      "shopify:no_vendor:1004/medium/observed",
      "shopify:unavailable:1004/low/observed",
      "shopify:no_weight:1004/medium/observed",
    ]);
    expect(result.findings[0].title).toContain("may be intentional");
    expect(result.findings[1].evidence).toBe('"Glossy": price 1599.00, compare at 1599.00; "Matte": price 1599.00, compare at 1499.00.');
    // The gift card (no shipping) is not flagged for weight 0.
    expect(result.findings.some((f) => f.finding_key === "shopify:no_weight:1005")).toBe(false);
  });

  it("reads at most 10 products", () => {
    const many = { products: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, title: `P${i}`, handle: `p${i}`, body_html: "x".repeat(100), vendor: "V", images: [{}], variants: [{ price: "5", grams: 10, available: true }] })) };
    const r = checkShopifyProducts(JSON.stringify(many), "https://s.test");
    expect(r.status === "ok" && r.checked).toBe(10);
  });

  it("treats a non-JSON answer as unavailable, not a problem", () => {
    expect(checkShopifyProducts("<html>Not found</html>", "https://s.test")).toMatchObject({ status: "unavailable" });
    expect(checkShopifyProducts('{"errors":"Not Found"}', "https://s.test")).toMatchObject({ status: "unavailable" });
  });
});

describe("public report for a Shopify store", () => {
  const input = (shopifyProducts: PageFetch | null): PublicScanInput => ({
    url: "https://badeloft.com/",
    host: "badeloft.com",
    checkedAt: "2026-10-21T12:00:00Z",
    requests: 10,
    robots: page(200, "User-agent: *\nDisallow: /cart\nSitemap: https://badeloft.com/sitemap.xml"),
    llms: page(404, "not found"),
    home: page(200, home, { shopifyHeader: true }),
    bots: { GPTBot: page(200, home), "OAI-SearchBot": page(200, home), ClaudeBot: page(200, home), PerplexityBot: page(200, home) },
    products: [{ url: "https://badeloft.com/products/bw-01-l-freestanding-bathtub", fetch: page(200, product) }],
    productSource: "home page links",
    shopifyProducts,
    gemini: { visibility: { status: "unavailable", reason: "x", prompt: "q" }, knowledge: { status: "unavailable", reason: "x", prompt: "k" } },
  });

  it("says Shopify, checks product pages and the product list", () => {
    const r = buildPublicReport(input(page(200, productsJson)));
    expect(r.platformName).toBe("Shopify");
    expect(r.shopifyList).toEqual({ status: "ok", checked: 5, note: SHOPIFY_LIST_NOTE });
    const keys = r.findings.map((f) => f.finding_key);
    expect(keys).toContain("platform:shopify");
    expect(keys).not.toContain("platform:not_woocommerce");
    expect(keys).not.toContain("schema:no_product_pages");
    expect(keys).toContain("shopify:compare_at_not_higher:1003");
    expect(r.pages.find((p) => p.kind === "product")?.priceCheck).toBe("match");
  });

  it("marks a closed product list as unavailable, not as a problem", () => {
    const r = buildPublicReport(input(page(404, '{"errors":"Not Found"}')));
    expect(r.shopifyList).toEqual({ status: "unavailable", reason: "HTTP 404" });
    const f = r.findings.find((x) => x.finding_key === "shopify:list_unavailable");
    expect(f).toMatchObject({ severity: "low", basis: "unavailable" });
    expect(f?.title).toContain("not a problem");
  });
});
