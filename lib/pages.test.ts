import { describe, expect, it } from "vitest";
import { checkStorePages, type PublicPage } from "./pages";

const URL = "https://matha.site";

// matha.site as published: shop/cart/checkout set and public, terms empty, no privacy page, returns page only a draft.
const mathaSettings = {
  woocommerce_shop_page_id: "125",
  woocommerce_cart_page_id: "126",
  woocommerce_checkout_page_id: "127",
  woocommerce_terms_page_id: "",
};
const mathaPages: PublicPage[] = [
  { id: 125, slug: "shop", title: "Shop" },
  { id: 126, slug: "cart", title: "Cart" },
  { id: 127, slug: "checkout", title: "Checkout" },
  { id: 128, slug: "my-account", title: "My account" },
  { id: 149, slug: "scan", title: "Free Website Scan" },
];

const keys = (f: ReturnType<typeof checkStorePages>) => f.map((x) => `${x.finding_key}/${x.basis}`);

describe("checkStorePages", () => {
  it("finds the three missing policies on matha.site", () => {
    const f = checkStorePages({ storeUrl: URL, settings: { ok: true, data: mathaSettings }, pages: { ok: true, data: mathaPages } });
    expect(keys(f)).toEqual(["page:terms/observed", "page:privacy/heuristic", "page:returns/heuristic"]);
    expect(f.every((x) => x.product_id === null && x.fix_url?.startsWith("https://matha.site/wp-admin/"))).toBe(true);
  });

  it("passes when everything is set and published", () => {
    const pages = [...mathaPages, { id: 200, slug: "terms", title: "Terms" }, { id: 201, slug: "privacy-policy", title: "Privacy Policy" }, { id: 202, slug: "refund_returns", title: "Refund and Returns Policy" }];
    const f = checkStorePages({ storeUrl: URL, settings: { ok: true, data: { ...mathaSettings, woocommerce_terms_page_id: "200" } }, pages: { ok: true, data: pages } });
    expect(f).toEqual([]);
  });

  it("flags an assigned page that is not published", () => {
    const f = checkStorePages({
      storeUrl: URL,
      settings: { ok: true, data: { ...mathaSettings, woocommerce_checkout_page_id: "999" } },
      pages: { ok: true, data: mathaPages },
    });
    const checkout = f.find((x) => x.finding_key === "page:checkout");
    expect(checkout?.type).toBe("checkout_page_unpublished");
    expect(checkout?.severity).toBe("high");
    expect(checkout?.fix_url).toBe("https://matha.site/wp-admin/post.php?post=999&action=edit");
  });

  it("reports unavailable instead of guessing when settings cannot be read", () => {
    const f = checkStorePages({ storeUrl: URL, settings: { ok: false, reason: "No permission." }, pages: { ok: true, data: mathaPages } });
    expect(keys(f).slice(0, 4)).toEqual(["page:shop:unavailable/unavailable", "page:cart:unavailable/unavailable", "page:checkout:unavailable/unavailable", "page:terms:unavailable/unavailable"]);
    expect(f[0].evidence).toBe("No permission.");
  });

  it("reports unavailable when pages cannot be read", () => {
    const f = checkStorePages({ storeUrl: URL, settings: { ok: true, data: mathaSettings }, pages: { ok: false, reason: "Blocked." } });
    expect(f.filter((x) => x.basis === "unavailable").map((x) => x.finding_key)).toEqual([
      "page:shop:unavailable", "page:cart:unavailable", "page:checkout:unavailable", "page:privacy:unavailable", "page:returns:unavailable",
    ]);
    expect(f.find((x) => x.finding_key === "page:terms")?.basis).toBe("observed");
  });
});
