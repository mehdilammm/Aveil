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
