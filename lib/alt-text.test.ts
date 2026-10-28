import { describe, expect, it } from "vitest";
import { altFindings, altProductOf, altText, EMPTY_ALT_VIA_REST, imageUseOf, planAlt, storedAlt, type AltProduct } from "./alt-text";

// matha.site as read on 2026-10-28 (feed and WooCommerce API): product 172's gallery shows the featured images of 176
// and 177, and every image has alt text. Image ids are stand-ins; the sharing is matha's.
const matha = (alt: { a?: string; b?: string; c?: string } = {}): AltProduct[] => [
  { id: 172, name: "Laser Engraved LED Mirror 80 x 120 cm", images: [{ id: 1001, alt: alt.a ?? "Greek key laser engraved LED mirror above a bathroom sink" }, { id: 1002, alt: alt.b ?? "Moroccan pattern laser engraved LED mirror" }, { id: 1003, alt: alt.c ?? "Leaf laser engraved LED mirror" }], variations: [] },
  { id: 176, name: "Moroccan Pattern Laser Engraved LED Mirror", images: [{ id: 1002, alt: alt.b ?? "Moroccan pattern laser engraved LED mirror" }], variations: [] },
  { id: 177, name: "Leaf Laser Engraved LED Mirror", images: [{ id: 1003, alt: alt.c ?? "Leaf laser engraved LED mirror" }], variations: [] },
];

describe("G4 image alt text: rules", () => {
  it("matha.site today: every image has alt text, nothing to write", () => {
    expect(altFindings(matha())).toEqual([]);
  });

  it("only empty alt text is written, with the product's name; existing alt text is never replaced", () => {
    const products = matha({ a: "  " });
    const f = altFindings(products);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ finding_key: "image_alt_missing:172", type: "image_alt_missing", product_id: 172, basis: "observed", severity: "low" });
    expect(planAlt(products[0], imageUseOf(products)).writes).toEqual([{ image: 1001, alt: "Laser Engraved LED Mirror 80 x 120 cm", variation: null }]);
  });

  it("an image several products show is left alone: matha's Moroccan pattern photo is on 172 and 176", () => {
    const products = matha({ b: "" });
    const f = altFindings(products);
    expect(f.map((x) => x.finding_key)).toEqual(["image_alt_shared:172", "image_alt_shared:176"]);
    expect(f[0].evidence).toBe("WooCommerce: image #1002 (used by products #172, #176) has empty alt text.");
    expect(planAlt(products[0], imageUseOf(products))).toEqual({ writes: [], shared: [{ image: 1002, products: [172, 176] }] });
    // With an empty own image too, the shared one is named in the evidence and not written.
    const both = matha({ a: "", b: "" });
    const g = altFindings(both).find((x) => x.product_id === 172)!;
    expect(g.type).toBe("image_alt_missing");
    expect(g.evidence).toContain("1 more is used by several products (image #1002: products #172, #176) and is left alone.");
  });

  it("variations: an image only one variation shows gets the name and that variation's options; the parent's image the name only", () => {
    const p = altProductOf(
      { id: 400, name: "Round LED Mirror", images: [{ id: 2000, src: "x", alt: "" }] },
      [
        { id: 401, price: "800", regular_price: "800", sale_price: "", virtual: false, weight: "15", image: { id: 2001, alt: "" }, attributes: [{ name: "Size", option: "60 cm" }, { name: "Light", option: "Warm" }] },
        // WooCommerce returns the parent's image for a variation without its own.
        { id: 402, price: "900", regular_price: "900", sale_price: "", virtual: false, weight: "15", image: { id: 2000, alt: "" }, attributes: [{ name: "Size", option: "80 cm" }] },
        { id: 403, price: "950", regular_price: "950", sale_price: "", virtual: false, weight: "15", image: { id: 2002, alt: "" }, attributes: [{ name: "Size", option: "90 cm" }] },
        { id: 404, price: "950", regular_price: "950", sale_price: "", virtual: false, weight: "15", image: { id: 2002, alt: "" }, attributes: [{ name: "Size", option: "100 cm" }] },
      ],
    );
    expect(planAlt(p, imageUseOf([p])).writes).toEqual([
      { image: 2000, alt: "Round LED Mirror", variation: null },
      { image: 2001, alt: "Round LED Mirror – Size: 60 cm, Light: Warm", variation: 401 },
      { image: 2002, alt: "Round LED Mirror", variation: 403 },
    ]);
  });

  it("the text is the merchant's name only: entities decoded, tags dropped, nothing added, at most 250 characters", () => {
    expect(altText("Mirror &amp; Frame <b>XL</b>")).toBe("Mirror & Frame XL");
    expect(altText("Mirror", [{ name: "Size", option: "" }])).toBe("Mirror");
    const long = altText(`${"Word ".repeat(80)}End`);
    expect(long.length).toBeLessThanOrEqual(250);
    expect(long.endsWith("Word")).toBe(true);
    // A placeholder image (id 0) is not an image.
    expect(altProductOf({ id: 1, name: "X", images: [{ id: 0, src: "placeholder", alt: "" }] }, []).images).toEqual([]);
  });

  it("what WooCommerce stores (wc_clean → sanitize_text_field), same results as WordPress 6.8.3 run on 2026-10-28", () => {
    // WooCommerce writes an alt only when !empty(): a single space passes and is stored trimmed, as an empty alt.
    expect(storedAlt(EMPTY_ALT_VIA_REST)).toBe("");
    expect(storedAlt("  ")).toBe("");
    expect(storedAlt("Round  LED\tMirror ")).toBe("Round LED Mirror");
    expect(storedAlt("Mirror 50%off")).toBe("Mirror 50%off");
    expect(storedAlt("Mirror %20x")).toBe("Mirror x");
    expect(storedAlt("Mirror – Size: 60 cm")).toBe("Mirror – Size: 60 cm");
  });
});
