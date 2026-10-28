import { describe, expect, it } from "vitest";
import { buildFeed, CSV_COLUMNS, minorUnits, toMinor, validateProduct, type FeedInput, type FeedProductIn } from "./feed-build";

// matha.site, 2026-10-28, read with the WooCommerce REST API (read only): products 170, 171, 172 as returned.
const brand = [{ id: 30, name: "Matha Mirrors" }];
const P170: FeedProductIn = {
  id: 170, name: "Round Plain Wall Mirror", type: "simple", status: "publish", catalog_visibility: "visible",
  permalink: "https://matha.site/product/round-plain-wall-mirror/",
  description: "<p>A simple round wall mirror for entrances, bathrooms and bedrooms. Made to order. The photo is an example of the style; your mirror is made to your size and may look slightly different. Size, price and production time to be confirmed.</p>\n",
  short_description: "<p>Round wall mirror without frame decoration.</p>\n",
  price: "500", regular_price: "500", sale_price: "", on_sale: false, purchasable: true, stock_status: "instock", sku: "MIR-PLN-01", global_unique_id: "",
  images: [{ id: 178, src: "https://matha.site/wp-content/uploads/2026/10/decor-bathroom-round-mirror-scaled.jpg", alt: "Example photo of a round mirror above a bathroom vanity" }],
  categories: [{ id: 27, name: "Plain Mirrors" }], brands: brand, attributes: [],
};
const P171: FeedProductIn = {
  ...P170, id: 171, name: "Rectangular Wall Mirror 80 x 120 cm", permalink: "https://matha.site/product/rectangular-wall-mirror-80-x-120-cm/", sku: "MIR-PLN-02",
  description: "<p>Rectangular wall mirror measuring 80 x 120 cm, without lighting. Made to order: other sizes are available on request and priced by size. Production time: about 1 day. Packed weight: about 15 kg. Glass thickness and frame to be confirmed.</p>\n",
  images: [],
};
const P172: FeedProductIn = {
  ...P170, id: 172, name: "Laser Engraved LED Mirror 80 x 120 cm", permalink: "https://matha.site/product/laser-engraved-led-mirror-80-x-120-cm/", price: "1200", regular_price: "1200", sku: "MIR-LSR-01",
  description: "<p>Rectangular mirror measuring 80 x 120 cm with a decorative laser-engraved pattern and built-in LED lighting that shines through the engraving.</p>\n",
  images: [
    { id: 188, src: "https://matha.site/wp-content/uploads/2026/10/file_0000000098a482118a1c4da6460a9bb2.png", alt: "Greek key laser engraved LED mirror above a bathroom sink" },
    { id: 184, src: "https://matha.site/wp-content/uploads/2026/10/file_000000004ab4820a861c7eeb042c54ed.png", alt: "Moroccan pattern laser engraved LED mirror" },
  ],
  categories: [{ id: 28, name: "Laser Engraved Mirrors" }, { id: 29, name: "LED Mirrors" }],
};
const CATEGORIES = [{ id: 28, name: "Laser Engraved Mirrors", parent: 0 }, { id: 29, name: "LED Mirrors", parent: 0 }, { id: 27, name: "Plain Mirrors", parent: 0 }, { id: 26, name: "Uncategorized", parent: 0 }];
const base: FeedInput = {
  feedId: "agentscope-c2ab0cfe", storeUrl: "https://matha.site", siteName: "Matha Mirrors", currency: "MAD", country: "MA",
  products: [P170, P171, P172], variations: {}, categories: CATEGORIES,
  links: [{ type: "refund_policy", title: "Refund and Returns Policy", url: "https://matha.site/refund_returns/" }],
  now: new Date("2026-10-28T09:00:00.123Z"),
};
const parse = (jsonl: string) => jsonl.trim().split("\n").map((l) => JSON.parse(l));
// RFC 4180 reader for the checks (quoted fields may hold commas, quotes and line breaks).
function csvRows(csv: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && csv[i + 1] === "\n") {
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += c;
  }
  return out;
}

describe("product feed (G1)", () => {
  it("matha.site: ACP products.jsonl from real data, valid against the 2026-04-17 schema, nothing invented", () => {
    const f = buildFeed(base);
    expect(f.metadata).toEqual({ id: "agentscope-c2ab0cfe", target_country: "MA", updated_at: "2026-10-28T09:00:00Z" });
    const products = parse(f.jsonl);
    expect(products).toHaveLength(3);
    for (const p of products) expect(validateProduct(p)).toBe(true);
    expect(products[0]).toEqual({
      id: "170",
      title: "Round Plain Wall Mirror",
      description: { plain: "A simple round wall mirror for entrances, bathrooms and bedrooms. Made to order. The photo is an example of the style; your mirror is made to your size and may look slightly different. Size, price and production time to be confirmed." },
      url: "https://matha.site/product/round-plain-wall-mirror/",
      media: [{ type: "image", url: "https://matha.site/wp-content/uploads/2026/10/decor-bathroom-round-mirror-scaled.jpg", alt_text: "Example photo of a round mirror above a bathroom vanity" }],
      variants: [{
        id: "170", title: "Round Plain Wall Mirror", url: "https://matha.site/product/round-plain-wall-mirror/",
        price: { amount: 50000, currency: "MAD" },
        availability: { available: true, status: "in_stock" },
        categories: [{ value: "Plain Mirrors", taxonomy: "merchant" }],
        seller: { name: "Matha Mirrors", links: [{ type: "refund_policy", title: "Refund and Returns Policy", url: "https://matha.site/refund_returns/" }] },
      }],
    });
    // No GTIN on matha → no barcodes; no condition in WooCommerce → none written.
    expect(f.jsonl).not.toMatch(/barcodes|condition|brand/);
    expect(f.counts).toMatchObject({ products: 3, variants: 3, excluded: 0 });
  });

  it("matha.site CSV: Google fields; #171 has no image, so its row is left out with the reason", () => {
    const f = buildFeed(base);
    const rows = csvRows(f.csv);
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    expect(rows.slice(1).map((r) => r[0])).toEqual(["170", "172"]);
    const r170 = Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, rows[1][i]]));
    expect(r170).toMatchObject({ id: "170", item_group_id: "", title: "Round Plain Wall Mirror", link: "https://matha.site/product/round-plain-wall-mirror/", availability: "in_stock", price: "500.00 MAD", sale_price: "", brand: "Matha Mirrors", gtin: "", product_type: "Plain Mirrors" });
    const r172 = Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, rows[2][i]]));
    expect(r172).toMatchObject({ image_link: "https://matha.site/wp-content/uploads/2026/10/file_0000000098a482118a1c4da6460a9bb2.png", additional_image_link: "https://matha.site/wp-content/uploads/2026/10/file_000000004ab4820a861c7eeb042c54ed.png", price: "1200.00 MAD", product_type: "Laser Engraved Mirrors" });
    expect(f.rows.find((r) => r.id === 171)).toMatchObject({ json: "included", csv: "excluded", csvMissing: ["image_link"], missing: ["image"] });
    expect(f.counts).toMatchObject({ csvRows: 2, csvExcluded: 1 });
  });

  it("prices in ISO 4217 minor units, exactly; a price that would need rounding is left out", () => {
    expect(minorUnits("MAD")).toBe(2);
    expect(minorUnits("JPY")).toBe(0);
    expect(minorUnits("KWD")).toBe(3);
    expect(toMinor("800", "MAD")).toBe(80000);
    expect(toMinor("799.9", "USD")).toBe(79990);
    expect(toMinor("1500", "JPY")).toBe(1500);
    expect(toMinor("12.345", "KWD")).toBe(12345);
    expect(toMinor("1500.5", "JPY")).toBeNull();
    expect(toMinor("", "MAD")).toBeNull();
    expect(toMinor("-5", "MAD")).toBeNull();
    const f = buildFeed({ ...base, products: [{ ...P170, price: "", regular_price: "" }] });
    const v = parse(f.jsonl)[0].variants[0];
    expect(v.price).toBeUndefined();
    expect(f.rows[0]).toMatchObject({ json: "included", csv: "excluded", csvMissing: ["price"], missing: ["price"] });
  });

  it("on sale: list_price and Google price + sale_price; a valid GTIN becomes a barcode, an invalid one is left out", () => {
    const f = buildFeed({ ...base, products: [{ ...P170, price: "450", sale_price: "450", on_sale: true, global_unique_id: "4006381333931" }, { ...P172, global_unique_id: "4006381333932" }] });
    const [a, b] = parse(f.jsonl);
    expect(a.variants[0]).toMatchObject({ price: { amount: 45000, currency: "MAD" }, list_price: { amount: 50000, currency: "MAD" }, barcodes: [{ type: "GTIN", value: "4006381333931" }] });
    expect(b.variants[0].barcodes).toBeUndefined();
    const row = Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, csvRows(f.csv)[1][i]]));
    expect(row).toMatchObject({ price: "500.00 MAD", sale_price: "450.00 MAD", gtin: "4006381333931" });
  });

  it("variable products: one variant per published variation with its options; item_group_id in the CSV", () => {
    const shirt: FeedProductIn = { ...P170, id: 300, name: "Linen Shirt", type: "variable", permalink: "https://matha.site/product/linen-shirt/", price: "300", regular_price: "", images: [{ src: "https://matha.site/shirt.jpg", alt: "" }] };
    const f = buildFeed({
      ...base,
      products: [shirt],
      variations: {
        300: [
          { id: 301, price: "300", regular_price: "300", sale_price: "", stock_status: "instock", purchasable: true, permalink: "https://matha.site/product/linen-shirt/?attribute_pa_size=m", attributes: [{ name: "Size", option: "M" }], image: { src: "https://matha.site/shirt-m.jpg", alt: "" }, global_unique_id: "" },
          { id: 302, price: "300", regular_price: "300", sale_price: "", stock_status: "outofstock", purchasable: true, attributes: [{ name: "Size", option: "L" }] },
          { id: 303, status: "private", price: "300", regular_price: "300", sale_price: "", attributes: [{ name: "Size", option: "XL" }] },
        ],
      },
    });
    const [p] = parse(f.jsonl);
    expect(p.media).toEqual([{ type: "image", url: "https://matha.site/shirt.jpg" }]); // empty alt is not filled in
    expect(p.variants.map((v: { id: string; title: string; availability: unknown; variant_options: unknown }) => [v.id, v.title, v.availability, v.variant_options])).toEqual([
      ["301", "Linen Shirt - M", { available: true, status: "in_stock" }, [{ name: "Size", value: "M" }]],
      ["302", "Linen Shirt - L", { available: false, status: "out_of_stock" }, [{ name: "Size", value: "L" }]],
    ]);
    const rows = csvRows(f.csv).slice(1);
    expect(rows.map((r) => [r[0], r[1], r[5]])).toEqual([["301", "300", "https://matha.site/shirt-m.jpg"], ["302", "300", "https://matha.site/shirt.jpg"]]);
  });

  it("left out with the reason: hidden, grouped, external, not https, variable without variations", () => {
    const f = buildFeed({
      ...base,
      products: [
        { ...P170, id: 1, catalog_visibility: "hidden" },
        { ...P170, id: 2, type: "grouped" },
        { ...P170, id: 3, type: "external" },
        { ...P170, id: 4, permalink: "http://matha.site/product/x/" },
        { ...P170, id: 5, type: "variable" },
      ],
    });
    expect(f.jsonl).toBe("");
    expect(f.rows.map((r) => [r.id, r.jsonReason])).toEqual([
      [1, "hidden in the catalog (Catalog visibility: Hidden)"],
      [2, "grouped product: the products in it are listed one by one"],
      [3, "external / affiliate product: sold on another site"],
      [4, "no public https page"],
      [5, "variable product without published variations"],
    ]);
    expect(csvRows(f.csv)).toHaveLength(1);
  });

  it("text from the store is decoded and escaped: entities, commas and quotes in the CSV, </script> stays data", () => {
    const f = buildFeed({ ...base, products: [{ ...P170, name: 'Mirror &#8211; "Big", 80 x 120 </script><script>alert(1)</script>', description: "<p>Line one,<br>line &amp; two</p><script>bad()</script>" }] });
    const [p] = parse(f.jsonl);
    expect(p.title).toBe('Mirror – "Big", 80 x 120');
    expect(p.description.plain).toBe("Line one, line & two");
    expect(f.csv).toContain('"Mirror – ""Big"", 80 x 120"');
    expect(csvRows(f.csv)[1][2]).toBe('Mirror – "Big", 80 x 120');
    expect(validateProduct(p)).toBe(true);
  });

  it("no currency: prices are left out and the store currency is reported missing", () => {
    const f = buildFeed({ ...base, currency: "", products: [P170] });
    expect(parse(f.jsonl)[0].variants[0].price).toBeUndefined();
    expect(f.rows[0].missing).toContain("store currency");
  });
});
