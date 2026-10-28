import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateJsonLd } from "./schema-vocab";

const root = join(__dirname, "..");
const hasPhp = !spawnSync("php", ["-v"]).error;
const run = () => {
  const r = spawnSync("php", [join(root, "lib/fixtures/fixes-harness.php"), "schema", join(root, "lib/fixtures/matha-product-jsonld-2026-10-28.json")], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout);
};

describe.skipIf(!hasPhp)("plugin 1.8.0 structured data builders (G2, G3, G5, G6, G7)", () => {
  const r = hasPhp ? run() : {};

  it("every node is valid schema.org (release 30.1)", () => {
    for (const k of ["org", "org_logo", "website", "website_plain", "breadcrumb", "returns_none", "returns_14", "product", "variable", "single_to_aggregate"]) expect([k, validateJsonLd(r[k])]).toEqual([k, []]);
    for (const k of ["ship_matha", "ship_800", "ship_1200"]) for (const d of r[k]) expect([k, validateJsonLd(d)]).toEqual([k, []]);
    for (const v of r.variants) expect(validateJsonLd(v)).toEqual([]);
  });

  it("G2 Organization on matha.site: name, address and the published phone; no logo, email or profiles it does not have", () => {
    expect(r.org).toEqual({ "@type": "OnlineStore", "@id": "https://matha.site/#organization", name: "Matha Mirrors", url: "https://matha.site/", telephone: "+212 637 037 640" });
    expect(r.org_logo).toMatchObject({ logo: { "@type": "ImageObject", url: "https://matha.site/logo.png" }, email: "hello@matha.site", sameAs: ["https://www.instagram.com/matha"] });
    expect(r.org_refused).toEqual([null, null, null]);
  });

  it("G5 WebSite: SearchAction only with a checked search address; BreadcrumbList from the category path", () => {
    expect(r.website.potentialAction).toEqual({ "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: "https://matha.site/?s={search_term_string}&post_type=product" }, "query-input": "required name=search_term_string" });
    expect(r.website.publisher).toEqual({ "@id": "https://matha.site/#organization" });
    expect(r.website_plain.potentialAction).toBeUndefined();
    expect(r.website_refused).toBeNull();
    expect(r.breadcrumb.itemListElement.map((i: { position: number; name: string }) => [i.position, i.name])).toEqual([[1, "Home"], [2, "LED Mirrors"], [3, "Round LED Mirror"]]);
  });

  it("G3 shipping: matha.site's Marrakech zone is free; a minimum-amount rule depends on the price and is left out for a range", () => {
    expect(r.ship_matha).toEqual([{ "@type": "OfferShippingDetails", shippingRate: { "@type": "MonetaryAmount", value: 0, currency: "MAD" }, shippingDestination: { "@type": "DefinedRegion", addressCountry: "MA", addressRegion: "Marrakech" } }]);
    expect(r.ship_800[0].shippingRate.value).toBe(35);
    expect(r.ship_1200[0].shippingRate.value).toBe(0);
    expect(r.ship_800[0].deliveryTime.handlingTime).toEqual({ "@type": "QuantitativeValue", minValue: 0, maxValue: 1, unitCode: "DAY" });
    expect(r.ship_range).toEqual([]);
    expect(r.ship_refused).toEqual([null, null, null]); // "10 * [qty]", a country name, handling 3–1 days
  });

  it("G7 return policy as confirmed; a finite window needs its number of days", () => {
    expect(r.returns_none).toEqual({ "@type": "MerchantReturnPolicy", applicableCountry: "MA", returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted", merchantReturnLink: "https://matha.site/refund_returns/" });
    expect(r.returns_14).toMatchObject({ applicableCountry: ["MA", "FR"], merchantReturnDays: 14, returnMethod: "https://schema.org/ReturnByMail", returnFees: "https://schema.org/FreeReturn" });
    expect(r.returns_refused).toEqual([null, null]);
  });

  it("matha.site's WooCommerce Product is extended in place: same @id, one Product, nothing replaced, nothing added twice", () => {
    const before = r.product_before;
    expect(r.product["@id"]).toBe(before["@id"]);
    const offer = r.product.offers[0];
    for (const [k, v] of Object.entries(before.offers[0])) if (k !== "seller") expect(offer[k]).toEqual(v);
    expect(offer.seller).toEqual({ ...before.offers[0].seller, "@id": "https://matha.site/#organization" });
    expect(offer.shippingDetails).toEqual(r.ship_matha);
    expect(offer.hasMerchantReturnPolicy).toEqual(r.returns_none);
    expect(r.product_twice_same).toBe(true);
    expect(JSON.stringify(r.product).match(/"@type":"Product"/g)).toHaveLength(1);
  });

  it("G6 variations: one Offer each inside the AggregateOffer, with its own shipping rate; no price → left out", () => {
    const agg = r.variable.offers[0];
    expect(agg).toMatchObject({ "@type": "AggregateOffer", lowPrice: "300", highPrice: "320", offerCount: 2 });
    expect(agg.shippingDetails).toBeUndefined();
    expect(agg.offers.map((o: { price: string; availability: string; sku?: string; gtin?: string }) => [o.price, o.availability, o.sku ?? null, o.gtin ?? null])).toEqual([
      ["300", "https://schema.org/InStock", "LS-M", "4006381333931"],
      ["320", "https://schema.org/OutOfStock", null, null],
    ]);
    expect(agg.offers[0].shippingDetails[0].shippingRate.value).toBe(35);
    expect(r.single_to_aggregate.offers[0]).toMatchObject({ "@type": "AggregateOffer", lowPrice: "300", highPrice: "300", offerCount: 1 });
  });

  it("</script> and & in store text cannot break out of the JSON-LD script", () => {
    const inner = r.script.slice(r.script.indexOf(">") + 1, r.script.lastIndexOf("</script>"));
    expect(inner).not.toMatch(/[<>&]/);
    expect(JSON.parse(inner)["@graph"][0].name).toBe("Mirrors </script><script>alert(1)</script> & co");
  });
});
