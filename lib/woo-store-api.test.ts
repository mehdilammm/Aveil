import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkStoreApiProducts, minorToMajor, pathOf } from "./woo-store-api";

const body = readFileSync(join(__dirname, "fixtures", "woo-store-api-products.json"), "utf8");

describe("WooCommerce Store API", () => {
  it("converts minor units", () => {
    expect(minorToMajor("8500", 2)).toBe(85);
    expect(minorToMajor("390", 0)).toBe(390);
    expect(minorToMajor("", 2)).toBeNull();
    expect(minorToMajor("12.5", 2)).toBeNull();
    expect(pathOf("https://shop.test/product/mint-tea/")).toBe("/product/mint-tea");
  });

  it("checks the products with the same rules as Shopify's list", () => {
    const r = checkStoreApiProducts(body);
    if (r.status !== "ok") throw new Error(r.reason);
    expect(r.checked).toBe(4);
    expect(r.findings.map((f) => `${f.finding_key}/${f.severity}`).sort()).toEqual([
      "wcstore:no_images:103/medium",
      "wcstore:price_zero:102/medium",
      "wcstore:sale_not_lower:103/medium",
      "wcstore:short_description:102/low",
    ]);
    expect(r.findings.find((f) => f.finding_key === "wcstore:sale_not_lower:103")?.evidence).toBe("Regular price 250 USD, sale price 300 USD.");
    expect(r.permalinks[0]).toBe("https://shop.test/product/walnut-cutting-board/");
    expect(r.prices.get("/product/walnut-cutting-board")).toBe(85);
    expect(r.prices.get("/product/mint-tea")).toBe(390);
  });

  it("anything other than a product list is unavailable", () => {
    expect(checkStoreApiProducts("<html>login</html>").status).toBe("unavailable");
    expect(checkStoreApiProducts('{"code":"rest_no_route"}').status).toBe("unavailable");
  });
});
