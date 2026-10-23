import { describe, expect, it } from "vitest";
import { checkCheckout, type CheckoutInput } from "./checkout";
import type { PageFetch } from "./woo";

const page = (status: number, body = "<html></html>", challengeHeader = false): PageFetch => ({ ok: true, status, finalUrl: "https://shop.test/checkout/", redirectedTo: null, bytes: body.length, body, challengeHeader });

// matha.site as read on 2026-10-23: guest checkout on, sells to all countries, ships to Morocco only, COD only.
const matha: CheckoutInput = {
  storeUrl: "https://matha.site",
  settings: { ok: true, data: { woocommerce_enable_guest_checkout: "yes", woocommerce_allowed_countries: "all", woocommerce_ship_to_countries: "" } },
  zones: {
    ok: true,
    data: [
      { id: 0, name: "Locations not covered by your other zones", locations: [], methods: [] },
      { id: 1, name: "Marrakech", locations: [{ code: "MA:MA-07", type: "state" }], methods: [{ method_id: "flat_rate", enabled: true }] },
      { id: 2, name: "Morocco", locations: [{ code: "MA", type: "country" }], methods: [{ method_id: "flat_rate", enabled: true }] },
    ],
  },
  gateways: { ok: true, data: [{ id: "bacs", title: "Direct bank transfer", enabled: false }, { id: "cheque", title: "Check payments", enabled: false }, { id: "cod", title: "Cash on delivery", enabled: true }] },
  checkoutPage: { url: "https://matha.site/checkout/", browser: page(200), bot: page(200) },
  products: { total: 10, outOfStock: 0, needShipping: 10 },
};
const keys = (i: CheckoutInput) => checkCheckout(i).map((f) => `${f.finding_key}/${f.severity}/${f.basis}`);

describe("checkout rules", () => {
  it("matha.site: COD only (info, heuristic) and sells everywhere but ships to Morocco only", () => {
    expect(keys(matha)).toEqual(["checkout:shipping_gap/medium/observed", "checkout:offline_payment_only/low/heuristic"]);
    expect(checkCheckout(matha)[0].evidence).toContain("(MA)");
  });

  it("guest checkout off", () => {
    expect(keys({ ...matha, settings: { ok: true, data: { ...(matha.settings as { ok: true; data: Record<string, string> }).data, woocommerce_enable_guest_checkout: "no" } } })).toContain("checkout:guest_disabled/high/observed");
  });

  it("no shipping method at all", () => {
    const zones = { ok: true as const, data: [{ id: 0, name: "Rest", locations: [], methods: [{ method_id: "flat_rate", enabled: false }] }] };
    expect(keys({ ...matha, zones })).toContain("checkout:no_shipping_method/high/observed");
    expect(keys({ ...matha, zones, products: { total: 3, outOfStock: 0, needShipping: 0 } })).not.toContain("checkout:no_shipping_method/high/observed");
  });

  it("no payment method enabled; online payment present means no info finding", () => {
    expect(keys({ ...matha, gateways: { ok: true, data: [{ id: "cod", title: "COD", enabled: false }] } })).toContain("checkout:no_payment/high/observed");
    expect(keys({ ...matha, gateways: { ok: true, data: [{ id: "cod", title: "COD", enabled: true }, { id: "stripe", title: "Card", enabled: true }] } })).not.toContain("checkout:offline_payment_only/low/heuristic");
  });

  it("checkout blocked for GPTBot, or behind a captcha", () => {
    expect(keys({ ...matha, checkoutPage: { url: "https://matha.site/checkout/", browser: page(200), bot: page(403) } })).toContain("checkout:blocked_bots/high/observed");
    expect(keys({ ...matha, checkoutPage: { url: "https://matha.site/checkout/", browser: page(200), bot: page(200, "", true) } })).toContain("checkout:blocked_bots/high/observed");
    // A 429 is a rate limit, not a block (seen on matha.site right after the access test): heuristic, medium.
    const limited = keys({ ...matha, checkoutPage: { url: "https://matha.site/checkout/", browser: page(200), bot: page(429), botRetried: true } });
    expect(limited).toContain("checkout:rate_limited_bots/medium/heuristic");
    expect(limited).not.toContain("checkout:blocked_bots/high/observed");
    const ev = checkCheckout({ ...matha, checkoutPage: { url: "https://matha.site/checkout/", browser: page(200), bot: page(429), botRetried: true } }).find((x) => x.type === "checkout_rate_limited_bots")!.evidence;
    expect(ev).toContain("even after waiting and one retry");
    // 401 and a challenge page in the body are blocks, like in the access test; 503 is not counted as a block.
    expect(keys({ ...matha, checkoutPage: { url: "x", browser: page(200), bot: page(401) } })).toContain("checkout:blocked_bots/high/observed");
    expect(keys({ ...matha, checkoutPage: { url: "x", browser: page(200), bot: page(200, "<title>Just a moment...</title>") } })).toContain("checkout:blocked_bots/high/observed");
    expect(keys({ ...matha, checkoutPage: { url: "x", browser: page(200), bot: page(503) } })).not.toContain("checkout:blocked_bots/high/observed");
    expect(keys({ ...matha, checkoutPage: { url: "x", browser: page(200, '<div class="cf-turnstile" data-sitekey="1"></div>'), bot: page(200) } })).toContain("checkout:captcha/medium/heuristic");
  });

  it("out of stock share", () => {
    expect(keys({ ...matha, products: { total: 10, outOfStock: 6, needShipping: 10 } })).toContain("checkout:out_of_stock/medium/observed");
    expect(keys({ ...matha, products: { total: 10, outOfStock: 1, needShipping: 10 } })).toContain("checkout:out_of_stock/low/observed");
  });

  it("settings that could not be read add nothing invented", () => {
    expect(keys({ ...matha, settings: { ok: false, reason: "no access" }, zones: { ok: false, reason: "x" }, gateways: { ok: false, reason: "x" }, checkoutPage: null })).toEqual([]);
  });
});
