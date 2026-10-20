import { describe, expect, it } from "vitest";
import { checkProduct, type WooProduct, type WooVariation } from "./rules";

const LONG = "A sturdy cotton tote bag with inner pocket, reinforced handles and a zip. Fits a laptop up to 15 inches.";

function product(over: Partial<WooProduct> = {}): WooProduct {
  return {
    id: 10,
    name: "Tote",
    type: "simple",
    price: "20",
    regular_price: "20",
    sale_price: "",
    description: `<p>${LONG}</p>`,
    images: [{ id: 5, src: "https://x/y.jpg" }],
    virtual: false,
    weight: "0.4",
    ...over,
  };
}

function variation(id: number, over: Partial<WooVariation> = {}): WooVariation {
  return { id, price: "10", regular_price: "10", sale_price: "", virtual: false, weight: "", ...over };
}

const types = (p: WooProduct, v?: WooVariation[]) => checkProduct(p, v).map((f) => `${f.type}/${f.severity}`);

describe("checkProduct", () => {
  it("passes a complete product", () => {
    expect(checkProduct(product())).toEqual([]);
  });

  it("flags price rules", () => {
    expect(types(product({ price: "", regular_price: "" }))).toEqual(["price_missing/high"]);
    expect(types(product({ price: "abc" }))).toEqual(["price_invalid/high"]);
    expect(types(product({ price: "-1" }))).toEqual(["price_negative/high"]);
    expect(types(product({ price: "0", regular_price: "0" }))).toEqual(["price_zero/medium"]);
    expect(types(product({ price: "25", regular_price: "20", sale_price: "25" }))).toEqual(["sale_price_not_lower/high"]);
    expect(types(product({ price: "20", regular_price: "20", sale_price: "20" }))).toEqual(["sale_price_not_lower/high"]);
    expect(types(product({ price: "15", regular_price: "20", sale_price: "15" }))).toEqual([]);
  });

  it("checks variations of variable products", () => {
    const parent = product({ type: "variable", price: "", regular_price: "", weight: "1" });
    expect(types(parent, [variation(1), variation(2)])).toEqual([]);
    expect(types(parent, [variation(1, { price: "0" }), variation(2, { price: "0" })])).toEqual(["price_zero_all_variations/medium"]);

    const some = checkProduct(parent, [variation(1, { price: "0" }), variation(2)]);
    expect(some.map((f) => f.type)).toEqual(["price_zero_some_variations"]);
    expect(some[0].evidence).toContain("#1");

    expect(types(parent, [variation(1, { price: "" }), variation(2)])).toEqual(["price_missing/high"]);
    expect(types(parent, [])).toEqual(["price_missing/high"]);
  });

  it("flags short description as heuristic", () => {
    const [f] = checkProduct(product({ description: "<p>Nice bag &amp; more</p>" }));
    expect(f.type).toBe("description_short");
    expect(f.severity).toBe("low");
    expect(f.basis).toBe("heuristic");
  });

  it("flags missing image, including the placeholder", () => {
    expect(types(product({ images: [] }))).toEqual(["image_missing/medium"]);
    expect(types(product({ images: [{ id: 0, src: "placeholder.png" }] }))).toEqual(["image_missing/medium"]);
  });

  it("flags weight only for physical products", () => {
    expect(types(product({ weight: "" }))).toEqual(["weight_missing/medium"]);
    expect(types(product({ weight: "0" }))).toEqual(["weight_missing/medium"]);
    expect(types(product({ weight: "", virtual: true }))).toEqual([]);
    expect(types(product({ weight: "", type: "external" }))).toEqual([]);

    const parent = product({ type: "variable", weight: "" });
    const f = checkProduct(parent, [variation(1, { weight: "" }), variation(2, { weight: "2" }), variation(3, { virtual: true })]);
    expect(f.map((x) => x.type)).toEqual(["weight_missing"]);
    expect(f[0].evidence).toContain("#1");
    expect(f[0].evidence).not.toContain("#2");
  });

  it("uses stable keys per product and type", () => {
    const [f] = checkProduct(product({ images: [] }));
    expect(f.finding_key).toBe("image_missing:10");
    expect(f.product_id).toBe(10);
  });
});
