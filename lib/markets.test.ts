import { describe, expect, it } from "vitest";
import { defaultMarket, inMarketScript, marketOf } from "./markets";

describe("markets", () => {
  it("the store's WooCommerce country gives the default market", () => {
    expect(defaultMarket("MA:MA-07")).toBe("MA");
    expect(defaultMarket("GB")).toBe("UK");
    expect(defaultMarket("DE")).toBe("US");
    expect(defaultMarket(null)).toBe("US");
  });
  it("script check: Arabic markets in Arabic letters (brand names in Latin allowed), others without Arabic", () => {
    expect(inMarketScript("أحسن مرايا LED للحمام", marketOf("SA")!)).toBe(true);
    expect(inMarketScript("best LED mirror", marketOf("SA")!)).toBe(false);
    expect(inMarketScript("best LED mirror for a bathroom", marketOf("UK")!)).toBe(true);
    expect(inMarketScript("meilleur miroir LED", marketOf("FR")!)).toBe(true);
    expect(inMarketScript("123 ?", marketOf("US")!)).toBe(false);
  });
});
