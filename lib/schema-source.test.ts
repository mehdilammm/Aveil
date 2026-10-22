import { describe, expect, it } from "vitest";
import { detectSchemaSources } from "./schema-source";

const url = "https://matha.site/product/round-led-mirror/";
const wc = `<script type="application/ld+json">{"@context":"https:\\/\\/schema.org\\/","@graph":[{"@context":"https:\\/\\/schema.org\\/","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"item":{"name":"Home","@id":"https:\\/\\/matha.site"}}]},{"@context":"https:\\/\\/schema.org\\/","@type":"Product","@id":"https:\\/\\/matha.site\\/product\\/round-led-mirror\\/#product","name":"Round LED Mirror","offers":[{"@type":"Offer","price":"800","priceCurrency":"MAD"}]}]}</script>`;
const yoast = `<script type="application/ld+json" class="yoast-schema-graph">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","@id":"${url}"},{"@type":"Organization","@id":"https://matha.site/#organization"}]}</script>`;
const yoastProduct = `<script type="application/ld+json" class="yoast-schema-graph">{"@context":"https://schema.org","@graph":[{"@type":["Product"],"@id":"${url}#product","name":"Round LED Mirror"}]}</script>`;
const rankMath = `<script type="application/ld+json" class="rank-math-schema-pro">{"@context":"https://schema.org","@graph":[{"@type":"Product","@id":"${url}#richSnippet","name":"Round LED Mirror"}]}</script>`;
const theme = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Round LED Mirror","offers":{"@type":"Offer","price":"800"}}</script>`;

describe("schema source and @id per product page", () => {
  it("WooCommerce core: footer script, Product @id = permalink#product", () => {
    const r = detectSchemaSources(wc, url);
    expect(r.primary).toEqual({ source: "woocommerce", id: `${url}#product`, type: "Product" });
    expect(r.duplicate).toBe(false);
  });

  it("Yoast graph without a Product, plus WooCommerce's Product: one product, from WooCommerce", () => {
    const r = detectSchemaSources(yoast + wc, url);
    expect(r.blocks.map((b) => b.source)).toEqual(["yoast", "woocommerce"]);
    expect(r.products).toHaveLength(1);
    expect(r.primary?.source).toBe("woocommerce");
  });

  it("Yoast WooCommerce SEO writing the Product with the same @id: not a duplicate", () => {
    const r = detectSchemaSources(yoastProduct + wc, url);
    expect(r.products.map((p) => p.source)).toEqual(["yoast", "woocommerce"]);
    expect(r.duplicate).toBe(false);
  });

  it("Rank Math Product next to WooCommerce's: two different @id = duplicate", () => {
    const r = detectSchemaSources(rankMath + wc, url);
    expect(r.primary).toEqual({ source: "rank_math", id: `${url}#richSnippet`, type: "Product" });
    expect(r.duplicate).toBe(true);
  });

  it("a theme Product without @id, and broken JSON", () => {
    const r = detectSchemaSources(theme + `<script type="application/ld+json" class="rank-math-schema">{oops</script>`, url);
    expect(r.primary).toEqual({ source: "theme_or_other", id: null, type: "Product" });
    expect(r.blocks).toEqual([{ source: "theme_or_other", invalid: false }, { source: "rank_math", invalid: true }]);
  });

  it("no JSON-LD at all", () => {
    expect(detectSchemaSources("<html><body>hi</body></html>", url)).toEqual({ blocks: [], products: [], primary: null, duplicate: false });
  });
});
