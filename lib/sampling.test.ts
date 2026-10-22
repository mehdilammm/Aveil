import { describe, expect, it } from "vitest";
import catalog from "./fixtures/matha-catalog-2026-10-22.json";
import { sampleProducts } from "./sampling";

describe("smart sampling", () => {
  it("matha.site has no sales yet: one product per category in turn (LED 8, then Plain 4 / Laser 4)", () => {
    const r = sampleProducts("https://matha.site", catalog.products, 5);
    expect(r.basis).toBe("category_coverage");
    // First category of each product: 27 Plain, 28 Laser, 29 LED.
    expect(r.items.map((p) => p.categories[0].id)).toEqual([29, 27, 28, 29, 27]);
    expect(new Set(r.items.map((p) => p.id)).size).toBe(5);
  });

  it("with sales: best sellers first", () => {
    const withSales = catalog.products.map((p) => ({ ...p, total_sales: p.id === 199 ? 7 : p.id === 172 ? 3 : 0 }));
    expect(sampleProducts("https://matha.site", withSales, 3).items.map((p) => p.id)).toEqual([199, 172, 170]);
    expect(sampleProducts("https://matha.site", withSales, 3).basis).toBe("sales");
  });

  it("Pro takes up to 50; products without a page on the store's host are left out", () => {
    expect(sampleProducts("https://matha.site", catalog.products, 50).items).toHaveLength(13);
    const off = [{ id: 1, permalink: "https://other.test/p/" }, { id: 2, permalink: "http://matha.site/p/" }, { id: 3, permalink: null }];
    expect(sampleProducts("https://matha.site", off, 5).items).toEqual([]);
  });
});
