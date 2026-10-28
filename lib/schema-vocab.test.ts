import { describe, expect, it } from "vitest";
import matha from "./fixtures/matha-product-jsonld-2026-10-28.json";
import { ancestors, SCHEMA_RELEASE, validateJsonLd } from "./schema-vocab";

describe("schema.org vocabulary check (release 30.1)", () => {
  it("matha.site's product page JSON-LD as WooCommerce prints it (2026-10-28) is valid", () => {
    expect(SCHEMA_RELEASE).toBe("30.1");
    expect(validateJsonLd(matha)).toEqual([]);
  });

  it("finds unknown types and properties, properties on the wrong type, and bad enumeration values", () => {
    expect(ancestors("OnlineStore").has("Organization")).toBe(true);
    expect(validateJsonLd({ "@type": "OnlineShop", name: "x" })).toEqual(["$: unknown type OnlineShop"]);
    expect(validateJsonLd({ "@type": "Product", colour: "red" })).toEqual(["$.colour: not a schema.org property"]);
    expect(validateJsonLd({ "@type": "Organization", lowPrice: 5 })).toEqual(["$.lowPrice: does not apply to Organization"]);
    expect(validateJsonLd({ "@type": "Offer", availability: "https://schema.org/Monday" })).toEqual(["$.availability: Monday is not one of ItemAvailability"]);
    expect(validateJsonLd({ "@type": "Offer", availability: "in stock" })).toEqual(['$.availability: "in stock" is not a member of ItemAvailability']);
    expect(validateJsonLd({ "@type": "Offer", shippingDetails: { "@type": "Brand", name: "x" } })).toEqual(["$.shippingDetails: Brand where OfferShippingDetails is expected"]);
    expect(validateJsonLd({ "@type": "Offer", shippingDetails: { name: "x" } })).toEqual(["$.shippingDetails: node without @type"]);
  });
});

describe("matha.site live after plugin 1.8.0 and auto-fix (2026-10-28 19:12 UTC)", () => {
  it("the home page (OnlineStore + WebSite with search) and the product page (WooCommerce + our shipping details) are valid schema.org", async () => {
    const live = (await import("./fixtures/matha-live-g-2026-10-28.json")).default;
    const home = JSON.parse(live.home);
    const product = JSON.parse(live.product);
    expect(validateJsonLd(home)).toEqual([]);
    expect(validateJsonLd(product)).toEqual([]);
    // One Product, one Organization: the plugin extended WooCommerce's offer, it did not print a second Product.
    const types = (g: { "@graph": { "@type": string }[] }) => g["@graph"].map((n) => n["@type"]);
    expect(types(product).filter((t) => t === "Product")).toHaveLength(1);
    expect(types(home)).toEqual(["OnlineStore", "WebSite"]);
    // JSON_HEX_AMP: the & of the search address is & in the page and & once parsed.
    expect(live.home).toContain("\\u0026post_type=product");
    expect(home["@graph"][1].potentialAction.target.urlTemplate).toBe("https://matha.site/?s={search_term_string}&post_type=product");
    expect(product["@graph"][1].offers[0].seller["@id"]).toBe("https://matha.site/#organization");
  });
});
