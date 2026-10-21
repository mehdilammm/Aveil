import { describe, expect, it } from "vitest";
import type { WooProduct } from "./rules";
import { checkStructuredData, extractSchemaProducts } from "./structured-data";

// Shape WooCommerce prints on product pages.
const wooLd = (price = "75.00", currency = "MAD", availability = "http://schema.org/InStock") => `
<script type="application/ld+json">{"@context":"https://schema.org/","@graph":[{"@context":"https://schema.org/","@type":"BreadcrumbList","itemListElement":[]},
{"@type":"Product","@id":"https://shop.test/product/tea/#product","name":"Mint Tea Box","url":"https://shop.test/product/tea/",
"image":"https://shop.test/wp-content/uploads/tea.jpg","sku":"AS-1",
"offers":[{"@type":"Offer","priceSpecification":[{"@type":"UnitPriceSpecification","price":"${price}","priceCurrency":"${currency}","valueAddedTaxIncluded":false}],
"availability":"${availability}","url":"https://shop.test/product/tea/"}]}]}</script>`;

const product = (over: Partial<WooProduct> = {}): WooProduct => ({
  id: 141, name: "Mint Tea Box", type: "simple", price: "75", regular_price: "75", sale_price: "", description: "", images: [], virtual: false, weight: "1", stock_status: "instock", ...over,
});

const page = (html: string | null, over: Partial<WooProduct> = {}) => ({ product: product(over), url: "https://shop.test/product/tea/", html });

describe("extractSchemaProducts", () => {
  it("reads WooCommerce's @graph with priceSpecification", () => {
    const { products } = extractSchemaProducts(`<html>${wooLd()}</html>`);
    expect(products).toEqual([{ kind: "Product", name: "Mint Tea Box", image: true, price: "75.00", currency: "MAD", availability: "http://schema.org/InStock", readable: true }]);
  });

  it("reads a plain Offer and counts invalid blocks", () => {
    const html = `<script type='application/ld+json'>{"@type":"Product","name":"X","image":["a.jpg"],"offers":{"@type":"Offer","price":12,"priceCurrency":"EUR","availability":"https://schema.org/OutOfStock"}}</script><script type="application/ld+json">{broken</script>`;
    const r = extractSchemaProducts(html);
    expect(r.products[0]).toEqual({ kind: "Product", name: "X", image: true, price: "12", currency: "EUR", availability: "https://schema.org/OutOfStock", readable: true });
    expect(r.invalidBlocks).toBe(1);
  });
});

describe("checkStructuredData", () => {
  it("passes when the page matches the API", () => {
    expect(checkStructuredData([page(wooLd())], "MAD")).toEqual([]);
  });

  it("flags a different price as HIGH", () => {
    const f = checkStructuredData([page(wooLd("90.00"))], "MAD");
    expect(f.map((x) => `${x.finding_key}/${x.severity}`)).toEqual(["schema_price_mismatch:141/high"]);
  });

  it("flags currency and stock differences", () => {
    const f = checkStructuredData([page(wooLd("75.00", "USD", "http://schema.org/OutOfStock"))], "MAD");
    expect(f.map((x) => x.type)).toEqual(["schema_currency_mismatch", "schema_availability_mismatch"]);
  });

  it("flags a missing Product and missing fields", () => {
    expect(checkStructuredData([page("<html>no data</html>")], "MAD")[0].type).toBe("schema_product_missing");
    const partial = `<script type="application/ld+json">{"@type":"Product","name":"X","offers":{"price":"75"}}</script>`;
    const [f] = checkStructuredData([page(partial)], "MAD");
    expect(f.type).toBe("schema_fields_missing");
    expect(f.evidence).toContain("priceCurrency, availability, image");
  });

  it("reports unavailable when the page could not be loaded", () => {
    const [f] = checkStructuredData([{ ...page(null), fetchError: "HTTP 500" }], "MAD");
    expect(f.basis).toBe("unavailable");
  });
});
