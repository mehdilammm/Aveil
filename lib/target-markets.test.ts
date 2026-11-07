import { describe, expect, it } from "vitest";
import { cleanMarkets, resolveTargets } from "./target-markets";

describe("target markets", () => {
  it("default = WooCommerce selling locations", () => {
    expect(resolveTargets(null, { woocommerce_allowed_countries: "specific", woocommerce_specific_allowed_countries: ["MA"] })).toEqual({ markets: ["MA"], source: "woocommerce" });
    expect(resolveTargets([], { woocommerce_allowed_countries: "all_except", woocommerce_all_except_countries: ["US", "FR"] }).markets).toEqual(["UK", "SA", "AE", "MA"]);
    expect(resolveTargets(null, { woocommerce_allowed_countries: "all" }).markets).toHaveLength(6);
  });
  it("the owner's choice wins", () => {
    expect(resolveTargets(["US", "MA"], { woocommerce_allowed_countries: "specific", woocommerce_specific_allowed_countries: "MA" })).toEqual({ markets: ["US", "MA"], source: "owner" });
  });
  it("only known markets are kept", () => {
    expect(cleanMarkets(["US", "XX", "US", 3, "MA"])).toEqual(["US", "MA"]);
    expect(cleanMarkets(null)).toBeNull();
  });
});
