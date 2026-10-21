import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPublicReport, visiblePrice, type PublicScanInput } from "./public-scan";
import { checkStructuredData, extractSchemaProducts } from "./structured-data";
import type { PageFetch } from "./woo";

// Fixtures written for these tests, in the shapes Shopify themes and SEO plugins use; not recorded from a store.
const fx = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const page = (status: number, body: string): PageFetch => ({ ok: true, status, finalUrl: "https://www.badeloft.com/", redirectedTo: null, bytes: body.length, body, challengeHeader: false });

describe("JSON-LD shapes", () => {
  it("reads a ProductGroup with hasVariant: lowest price, in stock if any variant is, image from variants", () => {
    const { products } = extractSchemaProducts(fx("shopify-productgroup.html"));
    expect(products[0]).toEqual({
      kind: "ProductGroup",
      name: "Smart Toilet ST-01",
      image: true,
      price: "2499.00",
      currency: "USD",
      availability: "http://schema.org/InStock",
      readable: true,
    });
    // Variants are not counted as separate page products, and the Organization block is ignored.
    expect(products).toHaveLength(1);
  });

  it("reads @graph, an AggregateOffer and an ImageObject, and ignores products in an ItemList", () => {
    const { products } = extractSchemaProducts(fx("aggregate-offer.html"));
    expect(products).toEqual([{ kind: "Product", name: "Floating Vanity", image: true, price: "799.00", currency: "USD", availability: "https://schema.org/InStock", readable: true }]);
  });

  it("reads several offers on one Product (lowest price)", () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"Tub","image":["a.jpg"],"offers":[{"@type":"Offer","price":1599,"priceCurrency":"USD","availability":"InStock"},{"@type":"Offer","price":1499,"priceCurrency":"USD","availability":"InStock"}]}</script>`;
    expect(extractSchemaProducts(html).products[0]).toMatchObject({ price: "1499", currency: "USD" });
  });

  it("marks a Product whose fields cannot be read as unreadable (unavailable), not incomplete", () => {
    const html = `<script type="application/ld+json">{"@type":"ProductGroup","productGroupID":"1","hasVariant":[{"@type":"Product","sku":"X"}]}</script>`;
    const schema = extractSchemaProducts(html).products[0];
    expect(schema.readable).toBe(false);
    const product = { id: 1, name: "T", type: "simple", price: "10", regular_price: "10", sale_price: "", description: "", images: [], virtual: false, weight: "1" };
    const [f] = checkStructuredData([{ product, url: "https://s.test/p/", html }], "USD");
    expect(f).toMatchObject({ type: "schema_unparsed", basis: "unavailable", severity: "low" });
  });
});

describe("price shown on the page", () => {
  it("takes the main product price, not the $29 cart, banner, installment or recommendation prices", () => {
    expect(visiblePrice(fx("shopify-productgroup.html"))).toEqual({ amount: 2499, text: "2,499.00", source: "price block" });
  });

  it("is unknown when only monthly or installment amounts are shown", () => {
    expect(visiblePrice(fx("installments-only.html"))).toEqual({ amount: null, text: null, source: null });
  });

  it("falls back to og:price:amount when there is no price block", () => {
    const html = `<html><head><meta property="og:price:amount" content="1,099.00"></head><body><p>no block</p></body></html>`;
    expect(visiblePrice(html)).toEqual({ amount: 1099, text: "1,099.00", source: "meta" });
  });
});

describe("Shopify product page in the public report", () => {
  const input = (productsJson: string | null): PublicScanInput => ({
    url: "https://www.badeloft.com/",
    host: "badeloft.com",
    checkedAt: "2026-10-21T12:00:00Z",
    requests: 10,
    robots: page(200, "User-agent: *\nSitemap: https://www.badeloft.com/sitemap.xml"),
    llms: page(404, "x"),
    home: page(200, fx("shopify-home.html")),
    bots: {},
    products: [{ url: "https://www.badeloft.com/products/smart-toilet-st-01", fetch: page(200, fx("shopify-productgroup.html")) }],
    productSource: "home page links",
    shopifyProducts: productsJson === null ? null : page(200, productsJson),
    gemini: { visibility: { status: "unavailable", reason: "x", prompt: "q" }, knowledge: { status: "unavailable", reason: "x", prompt: "k" } },
  });
  const list = (price: string) =>
    JSON.stringify({ products: [{ id: 7001, title: "Smart Toilet ST-01", handle: "smart-toilet-st-01", body_html: "x".repeat(100), vendor: "Badeloft", images: [{}], variants: [{ title: "White", price, grams: 50000, available: true }, { title: "Black", price: "2699.00", grams: 50000, available: false }] }] });

  it("no false 'incomplete' or price mismatch for the smart toilet page (ProductGroup)", () => {
    const r = buildPublicReport(input(list("2499.00")));
    const keys = r.findings.map((f) => f.finding_key);
    expect(keys).not.toContain("schema:fields:product1");
    expect(keys).not.toContain("price:mismatch:product1");
    expect(r.pages.find((p) => p.kind === "product")).toMatchObject({ priceCheck: "match", comparedWith: "store product list", storePrice: "2499", visiblePrice: "2,499.00" });
  });

  it("compares with the products.json price when available (most exact)", () => {
    const r = buildPublicReport(input(list("2299.00")));
    const f = r.findings.find((x) => x.finding_key === "price:mismatch:product1");
    expect(f).toMatchObject({ severity: "high", title: "Price in structured data differs from the store's product price" });
    expect(f?.evidence).toContain("/products.json) says 2299");
  });

  it("falls back to the price on the page without products.json", () => {
    const r = buildPublicReport(input(null));
    expect(r.pages.find((p) => p.kind === "product")).toMatchObject({ priceCheck: "match", comparedWith: "price on the page" });
  });
});
