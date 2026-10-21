import { describe, expect, it } from "vitest";
import { checkStoreGate, pageGate } from "./gate";
import { checkStructuredData } from "./structured-data";
import type { PageFetch } from "./woo";

const page = (status: number, body: string): PageFetch => ({ ok: true, status, finalUrl: "https://shop.test/", redirectedTo: null, bytes: body.length, body, challengeHeader: false });

// What WooCommerce prints for a logged-out visitor when Site visibility is Coming soon.
const WOO_COMING_SOON = `<!doctype html><html><head><meta name='woo-coming-soon-page' content='yes'><title>Matha</title></head><body class="home"><h1>Pardon our dust! We're working on something amazing — check back soon!</h1></body></html>`;

describe("pageGate", () => {
  it("detects the WooCommerce Coming soon page", () => {
    expect(pageGate(page(200, WOO_COMING_SOON))?.kind).toBe("coming_soon");
  });

  it("detects maintenance by 503 or title, and coming soon templates by title or body class", () => {
    expect(pageGate(page(503, "<title>Shop</title>"))?.kind).toBe("maintenance");
    expect(pageGate(page(200, "<title>Briefly unavailable for scheduled maintenance. Check back in a minute.</title>"))?.kind).toBe("maintenance");
    expect(pageGate(page(200, "<title>Coming Soon</title>"))?.kind).toBe("coming_soon");
    expect(pageGate(page(200, '<body class="page coming-soon-page">'))?.kind).toBe("coming_soon");
  });

  it("ignores normal pages, even with a product called Coming soon", () => {
    expect(pageGate(page(200, "<title>Shop – Matha</title><body class='home'>"))).toBeNull();
    expect(pageGate(page(200, "<title>Matha – Coming Soon Tee</title>"))).toBeNull();
    expect(pageGate({ ok: false, error: "timeout" })).toBeNull();
  });
});

describe("checkStoreGate", () => {
  const url = "https://matha.site";
  it("adds one LOW note from the setting (matha.site: store pages only)", () => {
    const f = checkStoreGate(url, { ok: true, data: { comingSoon: true, storePagesOnly: true } }, [{ label: "product page 1", gate: pageGate(page(200, WOO_COMING_SOON))! }]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ finding_key: "page:store_gate", type: "store_coming_soon", title: "Store is in Coming soon mode", severity: "low" });
    expect(f[0].evidence).toContain("store pages only");
  });

  it("works from page content when the setting cannot be read", () => {
    const f = checkStoreGate(url, { ok: false, reason: "no permission" }, [{ label: "home page", gate: pageGate(page(503, ""))! }]);
    expect(f[0].title).toBe("Store is in maintenance mode");
  });

  it("adds nothing for a live store", () => {
    expect(checkStoreGate(url, { ok: true, data: { comingSoon: false, storePagesOnly: false } }, [])).toEqual([]);
  });
});

describe("structured data on a closed store", () => {
  it("is unavailable with the reason, not schema_product_missing", () => {
    const product = { id: 141, name: "Tea", type: "simple", price: "75", regular_price: "75", sale_price: "", description: "", images: [], virtual: false, weight: "1" };
    const [f] = checkStructuredData([{ product, url: "https://matha.site/product/tea/", html: null, fetchError: pageGate(page(200, WOO_COMING_SOON))!.reason }], "MAD");
    expect(f.type).toBe("schema_unavailable");
    expect(f.basis).toBe("unavailable");
    expect(f.evidence).toContain("Coming soon");
  });
});
