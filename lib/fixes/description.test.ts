import { describe, expect, it } from "vitest";
import { buildDescription, cleanInputs, descriptionsCsv, diffLines, plain, type ProductFacts } from "./description";

// matha.site product 174 as its API returns it (short description, no attributes, weight 15, no size, no brand).
const mirror: ProductFacts = {
  id: 174, name: "Round LED Mirror", description: "<p>Round mirror with LED backlight.</p>", short_description: null,
  categories: ["LED Mirrors"], attributes: [], sku: "MIR-LED-01", gtin: null, brand: null, weight: "15", dimensions: { length: "", width: "", height: "" },
  weightUnit: "kg", dimensionUnit: "cm",
};

describe("factual description optimizer", () => {
  it("keeps the merchant's text and adds only store facts and typed inputs", () => {
    const d = buildDescription(mirror, cleanInputs({ material: "Glass and aluminium frame", care: "<b>Wipe</b> with a dry cloth" }));
    expect(d.html).toContain("<p>Round mirror with LED backlight.</p>");
    expect(d.lines).toEqual([
      { label: "Category", value: "LED Mirrors", source: "store" },
      { label: "Weight", value: "15 kg", source: "store" },
      { label: "SKU", value: "MIR-LED-01", source: "store" },
      { label: "Material", value: "Glass and aluminium frame", source: "merchant" },
      { label: "Care", value: "Wipe with a dry cloth", source: "merchant" },
    ]);
    // Unknown facts are flagged, never filled.
    expect(d.unknowns).toEqual(["size (length × width × height)", "brand", "GTIN / EAN barcode (only if the product has one)", "warranty or guarantee"]);
    expect(d.html).not.toMatch(/size|brand|gtin|warranty/i);
  });

  it("no numbers or words appear that are not in the inputs", () => {
    const d = buildDescription(mirror, {});
    const allowed = new Set("Round mirror with LED backlight. LED Mirrors 15 kg MIR-LED-01 Details Category Weight SKU".toLowerCase().split(/[^a-z0-9-]+/));
    for (const w of plain(d.html).toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean)) expect(allowed.has(w), w).toBe(true);
  });

  it("escapes markup from store data and inputs", () => {
    const d = buildDescription({ ...mirror, description: null, sku: '<script>x</script>' }, cleanInputs({ other: 'a "b" & c' }));
    expect(d.html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(d.html).toContain("a &quot;b&quot; &amp; c");
    expect(d.unknowns).toContain("a description in your own words");
  });

  it("side-by-side diff and the WooCommerce import CSV", () => {
    expect(diffLines("a\nb", "a\nc\nb")).toEqual([{ kind: "same", text: "a" }, { kind: "added", text: "c" }, { kind: "same", text: "b" }]);
    expect(descriptionsCsv([{ productId: 174, html: '<p>Say "hi"</p>' }, { productId: 2, html: "=SUM(A1)" }])).toBe('ID,Description\r\n174,"<p>Say ""hi""</p>"\r\n2,"\'=SUM(A1)"\r\n');
  });
});

describe("matha.site product 174, as read on 2026-10-23 (/wc/v3/products?include=174, store units lbs / in)", () => {
  const real: ProductFacts = {
    id: 174, name: "Round LED Mirror",
    description: "<p>A round mirror with built-in LED lighting. Light colour, switch type, power supply, size, price and stock to be confirmed.</p>\n",
    short_description: "<p>Round mirror with built-in LED lighting.</p>\n",
    categories: ["LED Mirrors"], attributes: [], sku: "MIR-LED-01", gtin: null, brand: "Matha Mirrors", weight: "15",
    dimensions: { length: "", width: "", height: "" }, weightUnit: "lbs", dimensionUnit: "in",
  };
  it("uses the store's own units and brand; size stays unknown because it is empty in the store", () => {
    const d = buildDescription(real, {});
    expect(d.lines.map((l) => `${l.label}: ${l.value}`)).toEqual(["Category: LED Mirrors", "Weight: 15 lbs", "Brand: Matha Mirrors", "SKU: MIR-LED-01"]);
    expect(d.unknowns).toEqual(["size (length × width × height)", "material", "GTIN / EAN barcode (only if the product has one)", "care instructions", "warranty or guarantee"]);
    expect(d.html.startsWith("<p>A round mirror with built-in LED lighting.")).toBe(true);
  });
});
