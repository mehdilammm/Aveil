import { describe, expect, it } from "vitest";
import type { Gateway, ShippingZone } from "./checkout";
import { marketCheckout, soldTo, zonesFor } from "./market-checkout";

// matha.site, 2026-10-27, read with the WooCommerce REST API (read only). Settings arrive as strings
// (fetchSettings turns the multiselect ["MA"] into "MA").
const SETTINGS = {
  woocommerce_allowed_countries: "specific",
  woocommerce_specific_allowed_countries: "MA",
  woocommerce_ship_to_countries: "",
  woocommerce_default_country: "MA:mamar",
  woocommerce_currency: "MAD",
  woocommerce_calc_taxes: "no",
  woocommerce_enable_guest_checkout: "yes",
};
const ZONES: ShippingZone[] = [
  { id: 0, name: "Locations not covered by your other zones", locations: [], methods: [] },
  { id: 1, name: "Marrakech", locations: [{ code: "MA:mamar", type: "state" }], methods: [{ method_id: "free_shipping", enabled: true }] },
  { id: 2, name: "Morocco", locations: [{ code: "MA", type: "country" }], methods: [{ method_id: "flat_rate", enabled: true }] },
];
const GATEWAYS: Gateway[] = [
  { id: "bacs", title: "Direct bank transfer", enabled: false },
  { id: "cheque", title: "Check payments", enabled: false },
  { id: "cod", title: "Cash on delivery", enabled: true },
];
const STATES = { US: 54, MA: 75 };
const matha = (markets: ("US" | "MA" | "FR")[], over: Partial<Parameters<typeof marketCheckout>[0]> = {}) =>
  marketCheckout({ markets, settings: SETTINGS, zones: ZONES, gateways: GATEWAYS, states: STATES, needsShipping: true, ...over });

describe("checkout by market (F6)", () => {
  it("matha.site, market US: No — not sold there, no shipping method outside Morocco; cash on delivery only; MAD", () => {
    const [us] = matha(["US"]);
    expect(us.verdict).toBe("no");
    expect(us.reasons.map((r) => [r.code, r.basis, r.blocker])).toEqual([
      ["notSold", "observed", true],
      ["noMethods", "observed", true],
      ["offlineOnly", "heuristic", false],
      ["statesAsked", "heuristic", false],
      ["currency", "observed", false],
    ]);
    expect(us.reasons.find((r) => r.code === "noMethods")!.values).toEqual({ zone: "Locations not covered by your other zones" });
    expect(us.reasons.find((r) => r.code === "offlineOnly")!.values).toEqual({ methods: "Cash on delivery" });
    expect(us.reasons.find((r) => r.code === "currency")!.values).toEqual({ store: "MAD", market: "USD" });
    expect(us.fixes).toEqual(["selling", "shipping"]);
  });

  it("matha.site, market MA: Probably — Morocco is covered (Marrakech zone first, then the Morocco zone), cash on delivery only", () => {
    expect(zonesFor(ZONES, "MA")).toEqual({ main: ZONES[2], parts: [ZONES[1]] });
    const [ma] = matha(["MA"]);
    expect(ma.verdict).toBe("probably");
    expect(ma.reasons.map((r) => r.code)).toEqual(["offlineOnly", "statesAsked"]);
    expect(ma.fixes).toEqual([]);
  });

  it("selling locations: specific, all except, all", () => {
    expect(soldTo({ woocommerce_allowed_countries: "specific", woocommerce_specific_allowed_countries: "MA,FR" }, "FR")).toBe(true);
    expect(soldTo({ woocommerce_allowed_countries: "all_except", woocommerce_all_except_countries: "FR" }, "FR")).toBe(false);
    expect(soldTo({ woocommerce_allowed_countries: "all" }, "US")).toBe(true);
  });

  it("zones: a continent covers the country; postcodes make a zone partial; a state-only zone with the rest uncovered", () => {
    const eu: ShippingZone = { id: 3, name: "Europe", locations: [{ code: "EU", type: "continent" }], methods: [{ method_id: "flat_rate", enabled: true }] };
    expect(zonesFor([ZONES[0], eu], "FR").main).toBe(eu);
    const paris: ShippingZone = { id: 4, name: "Paris", locations: [{ code: "FR", type: "country" }, { code: "75*", type: "postcode" }], methods: [{ method_id: "local_pickup", enabled: true }] };
    expect(zonesFor([ZONES[0], paris], "FR")).toEqual({ main: ZONES[0], parts: [paris] });
    const [fr] = marketCheckout({ markets: ["FR"], settings: { woocommerce_allowed_countries: "all", woocommerce_currency: "EUR" }, zones: [ZONES[0], paris], gateways: [{ id: "stripe", title: "Card", enabled: true }], states: {}, needsShipping: true });
    expect(fr.verdict).toBe("probably");
    expect(fr.reasons).toEqual([{ code: "partialZone", basis: "heuristic", blocker: false, values: { zone: "Paris" } }]);
  });

  it("a zone before the country's zone with no method leaves a gap", () => {
    const empty = { ...ZONES[1], methods: [{ method_id: "free_shipping", enabled: false }] };
    const [ma] = matha(["MA"], { zones: [ZONES[0], empty, ZONES[2]] });
    expect(ma.reasons[0]).toEqual({ code: "zoneGap", basis: "heuristic", blocker: false, values: { zone: "Marrakech" } });
    expect(ma.fixes).toEqual(["shipping"]);
  });

  it("blockers from the other settings, and unknown when zones or payments could not be read", () => {
    const [noShip] = matha(["MA"], { settings: { ...SETTINGS, woocommerce_ship_to_countries: "disabled" } });
    expect(noShip.reasons[0].code).toBe("shippingDisabled");
    const [notShipped] = matha(["MA"], { settings: { ...SETTINGS, woocommerce_ship_to_countries: "specific", woocommerce_specific_ship_to_countries: "FR" } });
    expect(notShipped.reasons[0]).toMatchObject({ code: "notShipped", values: { cc: "MA" } });
    const [guest] = matha(["MA"], { settings: { ...SETTINGS, woocommerce_enable_guest_checkout: "no" } });
    expect(guest.verdict).toBe("no");
    expect(guest.fixes).toEqual(["accounts"]);
    const [noPay] = matha(["MA"], { gateways: GATEWAYS.map((g) => ({ ...g, enabled: false })) });
    expect(noPay.reasons.map((r) => r.code)).toContain("noPayment");
    const [unknown] = matha(["MA"], { zones: null, gateways: null });
    expect(unknown.verdict).toBe("unknown");
    expect(unknown.reasons.map((r) => [r.code, r.basis])).toEqual([["zonesUnknown", "unavailable"], ["paymentsUnknown", "unavailable"], ["statesAsked", "heuristic"]]);
  });

  it("virtual products: shipping is not checked; a card gateway and guest checkout give Yes", () => {
    const [ma] = matha(["MA"], { needsShipping: false, gateways: [{ id: "stripe", title: "Card", enabled: true }], states: {} });
    expect(ma).toEqual({ market: "MA", country: "MA", verdict: "yes", reasons: [], fixes: [] });
  });
});
