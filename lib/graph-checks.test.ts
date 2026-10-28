import { describe, expect, it } from "vitest";
import type { ShippingZone } from "./checkout";
import matha from "./fixtures/matha-product-jsonld-2026-10-28.json";
import { graphFindings, jsonLdNodes } from "./graph-checks";
import { orgPayload, searchProbe, searchTemplate, searchWorks, shippingPayload } from "./schema-payloads";

// matha.site, 2026-10-28: the product page's JSON-LD as WooCommerce prints it, and the home page's contact line.
const productHtml = `<html><body><script type="application/ld+json">${JSON.stringify(matha)}</script></body></html>`;
const homeHtml = '<main><p class="has-text-align-center wp-block-paragraph">Custom size or design? Message us on WhatsApp: <a href="https://wa.me/212637037640">+212 637 037 640</a></p></main>';
// matha.site's shipping zones and methods (WooCommerce REST API, read only, 2026-10-28).
const ZONES: ShippingZone[] = [
  { id: 0, name: "Locations not covered by your other zones", locations: [], methods: [] },
  { id: 1, name: "Marrakech", locations: [{ code: "MA:mamar", type: "state" }], methods: [{ method_id: "free_shipping", enabled: true, title: "Free delivery in Marrakech", settings: { title: "Free delivery in Marrakech", requires: "", min_amount: "0", ignore_discounts: "no" } }] },
  { id: 2, name: "Morocco", locations: [{ code: "MA", type: "country" }], methods: [{ method_id: "flat_rate", enabled: true, title: "Delivery across Morocco", settings: { title: "Delivery across Morocco", tax_status: "taxable", cost: "35" } }] },
];
const STATES = { MA: { mamar: "Marrakech", macas: "Casablanca" } };

describe("structured data parts (G2, G3, G5, G6, G7)", () => {
  it("matha.site: no Organization or WebSite on the home page; BreadcrumbList already printed by WooCommerce; offers without shipping or return policy", () => {
    expect(jsonLdNodes(productHtml).map((n) => n["@type"])).toEqual(["BreadcrumbList", "ListItem", "ListItem", "ListItem", "Product", "Offer", "UnitPriceSpecification", "Organization", "Brand"]);
    const fs = graphFindings({ storeUrl: "https://matha.site", home: { url: "https://matha.site/", html: homeHtml }, product: { id: 174, url: "https://matha.site/product/round-led-mirror/", html: productHtml, needsShipping: true }, variable: null, seoPlugin: null });
    expect(fs.map((f) => [f.type, f.basis])).toEqual([
      ["jsonld_org_missing", "observed"],
      ["jsonld_website_missing", "observed"],
      ["jsonld_shipping_missing", "observed"],
      ["jsonld_returns_missing", "observed"],
    ]);
    expect(fs[0].evidence).toBe("https://matha.site/: no JSON-LD at all.");
  });

  it("the seller Organization inside an offer is not the store's Organization node; an SEO plugin is named", () => {
    const fs = graphFindings({ storeUrl: "https://matha.site", home: { url: "https://matha.site/", html: homeHtml }, product: null, variable: null, seoPlugin: "Yoast SEO" });
    expect(fs[0].guidance).toContain("Yoast SEO is active and prints its own");
    const withOrg = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"OnlineStore","@id":"https://matha.site/#organization","name":"Matha Mirrors"},{"@type":"WebSite","url":"https://matha.site/"}]}</script>`;
    expect(graphFindings({ storeUrl: "https://matha.site", home: { url: "https://matha.site/", html: withOrg }, product: null, variable: null, seoPlugin: null })).toEqual([]);
  });

  it("variations: one aggregate offer for 3 variations is a finding; per-variation offers are not", () => {
    const page = (offers: unknown) => `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", "@id": "x#product", name: "Shirt", offers })}</script>`;
    const agg = { "@type": "AggregateOffer", lowPrice: "300", highPrice: "320", offerCount: 3 };
    const v = (html: string) => graphFindings({ storeUrl: "https://s", home: null, product: null, variable: { id: 300, url: "https://s/p/", html, variations: 3 }, seoPlugin: null });
    expect(v(page([agg])).map((f) => [f.type, f.product_id])).toEqual([["jsonld_variants_missing", 300]]);
    expect(v(page([{ ...agg, offers: [{ "@type": "Offer", price: "300" }, { "@type": "Offer", price: "320" }] }]))).toEqual([]);
  });

  it("G2 payload: matha.site publishes its phone as a WhatsApp link; no email, no profile links", () => {
    const r = orgPayload([{ url: "https://matha.site/", html: homeHtml }]);
    expect(r).toEqual({ payload: { type: "OnlineStore", telephone: "+212 637 037 640" }, evidence: ['telephone: WhatsApp link "+212 637 037 640" on https://matha.site/'] });
    const other = orgPayload([{ url: "https://s/", html: '<a href="tel:+33%201%2023%2045%2067%2089">Call</a> <a href="mailto:hi@s.fr?subject=x">mail</a> <a href="https://www.instagram.com/shop.fr/">IG</a> <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a> <a href="https://x.com/intent/tweet">tweet</a>' }]);
    expect(other.payload).toEqual({ type: "OnlineStore", telephone: "+33 1 23 45 67 89", email: "hi@s.fr", same_as: ["https://www.instagram.com/shop.fr/"] });
  });

  it("G3 payload: matha.site's Marrakech zone (free) is exact; the Morocco flat rate is not written, because Marrakech is matched first", () => {
    const r = shippingPayload({ zones: ZONES, currency: "MAD", taxes: false, stateNames: STATES });
    expect(r.payload).toEqual({ currency: "MAD", zones: [{ country: "MA", region: "Marrakech", rates: [{ type: "free" }] }] });
    expect(r.flags).toEqual(['zone "Morocco" (MA): not written, because an earlier zone takes part of MA and schema.org cannot say "the rest of MA"']);
  });

  it("G3 payload: formulas, class costs, coupons, postcodes, plugin methods and taxes are flagged, not written", () => {
    const m = (method_id: string, settings: Record<string, string>, title = method_id) => ({ method_id, enabled: true, title, settings });
    const zones: ShippingZone[] = [
      { id: 1, name: "France", locations: [{ code: "FR", type: "country" }], methods: [m("flat_rate", { cost: "5 * [qty]" })] },
      { id: 2, name: "Spain", locations: [{ code: "ES", type: "country" }], methods: [m("flat_rate", { cost: "7", class_cost_12: "3" })] },
      { id: 3, name: "Italy", locations: [{ code: "IT", type: "country" }], methods: [m("free_shipping", { requires: "coupon" })] },
      { id: 4, name: "Paris", locations: [{ code: "75*", type: "postcode" }, { code: "FR", type: "country" }], methods: [m("flat_rate", { cost: "2" })] },
      { id: 5, name: "Germany", locations: [{ code: "DE", type: "country" }], methods: [m("table_rate", {}, "Table rate"), m("local_pickup", {})] },
      { id: 6, name: "Belgium", locations: [{ code: "BE", type: "country" }], methods: [m("flat_rate", { cost: "9.50" }), m("free_shipping", { requires: "min_amount", min_amount: "100" })] },
    ];
    const r = shippingPayload({ zones, currency: "EUR", taxes: false, stateNames: {} });
    expect(r.payload).toEqual({ currency: "EUR", zones: [{ country: "BE", rates: [{ type: "flat", cost: "9.50" }, { type: "free_min", min: "100" }] }] });
    expect(r.flags).toEqual([
      'zone "France": "flat_rate" cost "5 * [qty]" is a formula',
      'zone "Spain": "flat_rate" has shipping class costs',
      'zone "Italy": "free_shipping" needs a coupon',
      'zone "Paris": postcode locations cannot be written exactly',
      'zone "Germany": "Table rate" (table_rate) is calculated by a plugin',
    ]);
    expect(shippingPayload({ zones, currency: "EUR", taxes: true, stateNames: {} })).toEqual({ payload: null, flags: ["taxes are on: a shipping rate can include tax depending on the address, so none is written"] });
  });

  it("G5 search: the template, and a check that the results page links to the product", () => {
    expect(searchTemplate("https://matha.site")).toBe("https://matha.site/?s={search_term_string}&post_type=product");
    expect(searchProbe("https://matha.site", "Round LED")).toBe("https://matha.site/?s=Round%20LED&post_type=product");
    expect(searchWorks({ status: 200, html: '<a href="https://matha.site/product/round-led-mirror/">Round LED Mirror</a>' }, "https://matha.site/product/round-led-mirror/")).toBe(true);
    expect(searchWorks({ status: 200, html: "<p>No products were found</p>" }, "https://matha.site/product/round-led-mirror/")).toBe(false);
    expect(searchWorks(null, "x")).toBe(false);
  });
});
