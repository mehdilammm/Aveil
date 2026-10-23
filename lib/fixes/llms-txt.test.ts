import { describe, expect, it } from "vitest";
import catalog from "../fixtures/matha-catalog-2026-10-22.json";
import { buildLlmsTxt, classifyPages } from "./llms-txt";

const pages = classifyPages(
  [{ id: 5, slug: "shop", title: "Shop" }, { id: 6, slug: "cart", title: "Cart" }, { id: 7, slug: "checkout", title: "Checkout" }, { id: 3, slug: "privacy-policy", title: "Privacy Policy" }, { id: 9, slug: "about", title: "About us" }],
  { woocommerce_shop_page_id: "5", woocommerce_cart_page_id: "6", woocommerce_checkout_page_id: "7" },
  "https://matha.site",
);

describe("llms.txt from the store's own data", () => {
  it("matha.site: name, categories with counts, products with price, policy; cart and checkout left out", () => {
    const r = buildLlmsTxt({
      storeUrl: "https://matha.site",
      siteName: "Matha Mirrors",
      tagline: null,
      currency: "MAD",
      pages,
      categories: [{ name: "LED Mirrors", url: "https://matha.site/product-category/led-mirrors/", count: 8 }, { name: "Uncategorized", url: "https://matha.site/product-category/uncategorized/", count: 0 }],
      products: catalog.products.slice(2, 4).map((p) => ({ name: p.name, url: p.permalink, price: p.price || null, category: p.categories[0].name })),
    });
    expect(r.text).toContain("# Matha Mirrors");
    expect(r.text).toContain("- [LED Mirrors](https://matha.site/product-category/led-mirrors/): 8 products");
    expect(r.text).not.toContain("Uncategorized");
    expect(r.text).toContain("- [Laser Engraved LED Mirror 80 x 120 cm](https://matha.site/product/laser-engraved-led-mirror-80-x-120-cm/): 1200 MAD, Laser Engraved Mirrors");
    // Product 173 has no price on matha.site: listed without one, and reported.
    expect(r.text).toContain("- [Custom Laser Engraved Mirror](https://matha.site/product/custom-laser-engraved-mirror/): Laser Engraved Mirrors\n");
    expect(r.text).toContain("## Policies\n\n- [Privacy Policy](https://matha.site/privacy-policy/)");
    expect(r.text).not.toMatch(/cart|checkout/i);
    expect(r.missing).toEqual(["site tagline (Settings → General)", "price on 1 listed product(s)"]);
  });

  it("never invents: no name, no pages, no products gives a minimal file and the list of what is missing", () => {
    const r = buildLlmsTxt({ storeUrl: "https://x.test", siteName: null, tagline: null, currency: null, pages: [], categories: [], products: [] });
    expect(r.text).toBe("# x.test\n");
    expect(r.missing).toContain("published policy pages (returns, privacy, terms)");
  });

  it("brackets in names cannot break the links", () => {
    const r = buildLlmsTxt({ storeUrl: "https://x.test", siteName: "S", tagline: "t", currency: null, pages: [], categories: [], products: [{ name: "Mirror [XL] &amp; frame", url: "https://x.test/p/", price: "5", category: null }] });
    expect(r.text).toContain("- [Mirror \\[XL\\] & frame](https://x.test/p/): 5");
  });
});

import { wafGuide } from "./waf";
describe("WAF guidance (copy only)", () => {
  it("Cloudflare: the bot settings and a skip rule for verified bots; 429 gets its own step", () => {
    const g = wafGuide({ vendor: "Cloudflare", blocked: ["GPTBot"], rateLimited: ["ClaudeBot"], challenged: [] });
    expect(g.steps[0]).toContain("GPTBot, ClaudeBot");
    expect(g.steps.join(" ")).toContain("(cf.client.bot)");
    expect(g.steps.some((s) => s.startsWith("ClaudeBot got HTTP 429"))).toBe(true);
    expect(g.verifyLists).toHaveLength(4);
  });
  it("no vendor recognised: says so instead of guessing", () => {
    expect(wafGuide({ vendor: null, blocked: [], rateLimited: [], challenged: [] }).vendor).toBe("not recognised");
  });
});
