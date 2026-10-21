import { describe, expect, it } from "vitest";
import { checkFeedProduct, checkFeedStore, isValidGtin } from "./feed";
import type { WooProduct } from "./rules";

function product(over: Partial<WooProduct> = {}): WooProduct {
  return {
    id: 141,
    name: "Mint Tea Box",
    type: "simple",
    price: "75",
    regular_price: "75",
    sale_price: "",
    description: "<p>Green tea with mint.</p>",
    short_description: "",
    images: [{ id: 1, src: "https://x/y.jpg" }],
    virtual: false,
    weight: "1",
    permalink: "https://matha.site/product/mint-tea-box/",
    stock_status: "instock",
    global_unique_id: "4006381333931",
    brands: [{ id: 3, name: "Matha" }],
    attributes: [],
    ...over,
  };
}

const types = (p: WooProduct) => checkFeedProduct(p).map((f) => `${f.type}/${f.severity}/${f.basis}`);

describe("isValidGtin", () => {
  it("checks length and check digit", () => {
    expect(isValidGtin("4006381333931")).toBe(true); // EAN-13
    expect(isValidGtin("036000291452")).toBe(true); // UPC-A
    expect(isValidGtin("96385074")).toBe(true); // EAN-8
    expect(isValidGtin("4006381333932")).toBe(false);
    expect(isValidGtin("12345")).toBe(false);
    expect(isValidGtin("40063813339a1")).toBe(false);
  });
});

describe("checkFeedProduct", () => {
  it("passes a complete product", () => {
    expect(checkFeedProduct(product())).toEqual([]);
  });

  it("flags missing required fields", () => {
    expect(types(product({ name: " " }))).toEqual(["feed_title_missing/high/observed"]);
    expect(types(product({ description: "", short_description: "<p> </p>" }))).toEqual(["feed_description_missing/high/observed"]);
    expect(types(product({ description: "", short_description: "Short text" }))).toEqual([]);
    expect(types(product({ permalink: "" }))).toEqual(["feed_url_missing/high/observed"]);
  });

  it("flags a missing brand, but accepts a Brand attribute", () => {
    expect(types(product({ brands: [] }))).toEqual(["feed_brand_missing/high/observed"]);
    expect(types(product({ brands: undefined }))).toEqual(["feed_brand_missing/high/heuristic"]);
    expect(types(product({ brands: [], attributes: [{ name: "Brand", options: ["Matha"] }] }))).toEqual([]);
  });

  it("maps availability", () => {
    expect(types(product({ stock_status: "outofstock" }))).toEqual([]);
    expect(types(product({ stock_status: "onbackorder" }))).toEqual([]);
    expect(types(product({ stock_status: "custom" }))).toEqual(["feed_availability_unmapped/medium/observed"]);
  });

  it("validates GTIN and reports missing identifiers as low", () => {
    expect(types(product({ global_unique_id: "4006381333932" }))).toEqual(["feed_gtin_invalid/high/observed"]);
    expect(types(product({ global_unique_id: "" }))).toEqual(["feed_identifier_missing/low/observed"]);
    expect(types(product({ global_unique_id: undefined }))).toEqual(["feed_identifier_missing/low/heuristic"]);
    expect(types(product({ global_unique_id: "", attributes: [{ name: "MPN", options: ["AB-12"] }] }))).toEqual([]);
  });

  it("matches the matha.site test products: no brand, no GTIN", () => {
    const f = checkFeedProduct(product({ brands: [], global_unique_id: "", attributes: [] }));
    expect(f.map((x) => x.finding_key)).toEqual(["feed_brand_missing:141", "feed_identifier_missing:141"]);
    expect(f[0].guidance).toContain("developers.openai.com/commerce/specs/file-upload/products");
  });
});

describe("checkFeedStore", () => {
  const url = "https://matha.site";
  it("passes with a site name and currency", () => {
    expect(checkFeedStore({ storeUrl: url, siteName: { ok: true, data: "Matha" }, settings: { ok: true, data: { woocommerce_currency: "MAD" } } })).toEqual([]);
  });

  it("flags missing or unreadable values", () => {
    const f = checkFeedStore({ storeUrl: url, siteName: { ok: true, data: "" }, settings: { ok: false, reason: "No permission." } });
    expect(f.map((x) => `${x.finding_key}/${x.basis}`)).toEqual(["feed_seller_name_missing:store/observed", "feed_currency_unavailable:store/unavailable"]);
    const g = checkFeedStore({ storeUrl: url, siteName: { ok: false, reason: "Blocked." }, settings: { ok: true, data: { woocommerce_currency: "" } } });
    expect(g.map((x) => `${x.finding_key}/${x.severity}`)).toEqual(["feed_seller_name_unavailable:store/low", "feed_currency_missing:store/high"]);
  });
});
