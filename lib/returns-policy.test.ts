import { describe, expect, it } from "vitest";
import { checkReturnsAnswer, proposeReturns, returnsHash } from "./returns-policy";

// matha.site's Returns Policy page (WordPress REST API, read only, 2026-10-28), as published.
const MATHA = '\n<p class="wp-block-paragraph">Every Matha Mirrors mirror is made to order.</p>\n\n\n\n<h2 class="wp-block-heading">No returns</h2>\n\n\n\n<p class="wp-block-paragraph">All mirrors are final sale. Mirrors cannot be returned or refunded.</p>\n\n\n\n<h2 class="wp-block-heading">Check your mirror at delivery</h2>\n\n\n\n<p class="wp-block-paragraph">Orders are paid cash on delivery. Please check your mirror before you pay. If it is damaged or different from what you ordered, you can refuse the delivery.</p>\n\n\n\n<h2 class="wp-block-heading">Cancelling an order</h2>\n\n\n\n<p class="wp-block-paragraph">You can cancel your order free of charge before production starts. Please contact us as soon as possible.</p>\n\n\n\n<h2 class="wp-block-heading">Contact</h2>\n\n\n\n<p class="wp-block-paragraph">WhatsApp or phone: <a href="https://wa.me/212637037640">+212 637 037 640</a></p>\n';
const page = (html: string) => ({ url: "https://matha.site/refund_returns/", html });

describe("return policy proposal (G7)", () => {
  it("matha.site: no returns, sold in Morocco, with the exact sentences it is based on", () => {
    const r = proposeReturns({ page: page(MATHA), sellingCountries: ["MA"] });
    expect(r.proposal).toEqual({ category: "MerchantReturnNotPermitted", countries: ["MA"], link: "https://matha.site/refund_returns/" });
    expect(r.basis).toEqual(["No returns", "All mirrors are final sale.", "Mirrors cannot be returned or refunded."]);
    expect(r.hash).toBe(returnsHash(r.proposal!));
  });

  it("a return window in days; fees and method only when the page names them", () => {
    const r = proposeReturns({ page: page("<p>You can return any item within 14 days of delivery.</p><p>Return shipping is free: send it back by post.</p>"), sellingCountries: ["FR", "BE"] });
    expect(r.proposal).toEqual({ category: "MerchantReturnFiniteReturnWindow", days: 14, countries: ["FR", "BE"], link: "https://matha.site/refund_returns/", fees: "FreeReturn", method: "ReturnByMail" });
    const plain = proposeReturns({ page: page("<p>Returns are accepted within 30 days.</p>"), sellingCountries: ["FR"] });
    expect(plain.proposal).toEqual({ category: "MerchantReturnFiniteReturnWindow", days: 30, countries: ["FR"], link: "https://matha.site/refund_returns/" });
  });

  it("unclear pages become a question, never a guess", () => {
    expect(proposeReturns({ page: page("<p>Contact us about your order.</p>"), sellingCountries: ["MA"] }).unclear).toBe("The page does not say plainly whether returns are accepted or for how many days.");
    expect(proposeReturns({ page: page("<p>Sale items are final sale.</p><p>Other items can be returned within 30 days.</p>"), sellingCountries: ["MA"] })).toMatchObject({ proposal: null, unclear: "The page says more than one thing about returns." });
    expect(proposeReturns({ page: page("<p>Returns within 14 days, or 30 days for members.</p>"), sellingCountries: ["MA"] }).unclear).toMatch(/several numbers of days/);
    expect(proposeReturns({ page: page(MATHA), sellingCountries: null }).unclear).toMatch(/sells to every country/);
    expect(proposeReturns({ page: null, sellingCountries: ["MA"] }).unclear).toMatch(/No returns page/);
  });

  it("the merchant's answer is checked", () => {
    expect(checkReturnsAnswer('{"category":"MerchantReturnFiniteReturnWindow","days":"14","countries":["ma"," fr "]}')).toEqual({ ok: true, value: { category: "MerchantReturnFiniteReturnWindow", days: 14, countries: ["MA", "FR"] } });
    expect(checkReturnsAnswer('{"category":"MerchantReturnFiniteReturnWindow","countries":["MA"]}')).toEqual({ ok: false, reason: "Enter the number of days (1 to 365)." });
    expect(checkReturnsAnswer('{"category":"Maybe","countries":["MA"]}').ok).toBe(false);
    expect(checkReturnsAnswer("not json").ok).toBe(false);
  });
});
