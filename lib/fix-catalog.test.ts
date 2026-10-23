import { describe, expect, it } from "vitest";
import real from "./fixtures/matha-findings-2026-10-23.json";
import checkout from "./fixtures/matha-2026-10-23.json";
import { checkInput, fixFor, shipCountries } from "./fix-catalog";

describe("fix types", () => {
  it("matha.site's real findings: llms.txt auto, shipping one-click, price/images/GTIN input, firewall guide", () => {
    const by = Object.fromEntries(real.findings.map((f) => [f.finding_key, fixFor({ ...f, evidence: f.type === "schema_fields_missing" ? "The JSON-LD Product on x has no image." : "" })]));
    expect(by["llms_txt:missing"]).toEqual({ type: "auto", kind: "llms_txt" });
    expect(by["checkout:shipping_gap"]).toEqual({ type: "one_click", kind: "sell_where_ship" });
    expect(by["price_missing:173"]).toEqual({ type: "input", kind: "price", field: "price" });
    expect(by["image_missing:171"]).toEqual({ type: "input", kind: "image", field: "image" });
    expect(by["schema_fields_missing:171"]).toEqual({ type: "input", kind: "image", field: "image" });
    expect(by["schema_product_missing:173"]).toEqual({ type: "input", kind: "price", field: "price" });
    expect(by["feed_identifier_missing:170"]).toEqual({ type: "input", kind: "gtin", field: "gtin" });
    expect(by["access:GPTBot"].type).toBe("guide");
    expect(by["checkout:offline_payment_only"].type).toBe("guide");
  });

  it("robots: search agents auto, training crawlers stay the merchant's choice", () => {
    expect(fixFor({ type: "robots_blocks_bot", finding_key: "robots:OAI-SearchBot", evidence: "", product_id: null }).type).toBe("auto");
    expect(fixFor({ type: "robots_blocks_bot", finding_key: "robots:GPTBot", evidence: "", product_id: null }).type).toBe("guide");
  });

  it("inputs are checked, never guessed", () => {
    expect(checkInput("price", "799.90")).toEqual({ ok: true, value: "799.90" });
    expect(checkInput("price", "0").ok).toBe(false);
    expect(checkInput("gtin", "4006381333931")).toEqual({ ok: true, value: "4006381333931" });
    expect(checkInput("gtin", "4006381333932").ok).toBe(false);
    expect(checkInput("image", "https://matha.site/wp-content/uploads/mirror.jpg").ok).toBe(true);
    expect(checkInput("image", "http://x.test/a.jpg").ok).toBe(false);
  });

  it("matha.site ships to Morocco only (Marrakech state + Morocco)", () => {
    expect(shipCountries(checkout.zones)).toEqual(["MA"]);
    expect(shipCountries([{ locations: [{ code: "EU", type: "continent" }] }])).toBeNull();
  });
});
