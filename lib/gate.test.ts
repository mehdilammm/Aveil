import { describe, expect, it } from "vitest";
import type { PageResult } from "./access";
import { checkStoreGate, pageGate, resolveGate } from "./gate";
import { checkStructuredData, schemaPagesFrom } from "./structured-data";
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

// matha.site product pages: classic theme, so WooCommerce's meta tag is missing; the Coming soon block is there.
const CLASSIC_THEME_PRODUCT = `<!doctype html><html><head><title>TEST Healthy - Mint Tea Box – Matha</title></head>
<body class="product-template-default single single-product"><header>Matha</header>
<div class="wp-block-woocommerce-coming-soon woocommerce-coming-soon-store-only"><h1>Great things are on the horizon</h1></div></body></html>`;
// Same page with no marker at all (for example a theme that drops the block class).
const NO_MARKER_PRODUCT = `<!doctype html><html><head><title>Matha</title></head><body class="single-product"><p>Something is coming.</p></body></html>`;

describe("Coming soon on matha.site product pages (store pages only)", () => {
  const setting = { ok: true as const, data: { comingSoon: true, storePagesOnly: true } };
  const product = { id: 130, name: "Tea", type: "simple", price: "75", regular_price: "75", sale_price: "", description: "", images: [], virtual: false, weight: "1" };

  it("finds the Coming soon block without the meta and says what the page had", () => {
    const g = pageGate(page(200, CLASSIC_THEME_PRODUCT));
    expect(g?.kind).toBe("coming_soon");
    expect(g?.reason).toContain('title "TEST Healthy - Mint Tea Box – Matha"');
    expect(g?.reason).toContain("coming-soon meta: no");
    expect(g?.reason).toContain("coming-soon block: yes");
  });

  it("uses the setting when the page has no marker, but not for the home page", () => {
    const g = resolveGate(page(200, NO_MARKER_PRODUCT), setting, "product");
    expect(g?.reason).toContain("store pages only");
    expect(g?.reason).toContain("HTTP 200");
    expect(g?.reason).toContain("coming-soon meta: no");
    expect(resolveGate(page(200, NO_MARKER_PRODUCT), setting, "home")).toBeNull();
    expect(resolveGate(page(200, NO_MARKER_PRODUCT), { ok: true, data: { comingSoon: true, storePagesOnly: false } }, "home")).not.toBeNull();
    expect(resolveGate(page(200, NO_MARKER_PRODUCT), { ok: true, data: { comingSoon: false, storePagesOnly: true } }, "product")).toBeNull();
  });

  it("turns JSON-LD into UNAVAILABLE for schema_product_missing:130 and :131", () => {
    for (const html of [CLASSIC_THEME_PRODUCT, NO_MARKER_PRODUCT]) {
      const browser = page(200, html);
      const gate = resolveGate(browser, setting, "product");
      const accessPages: PageResult[] = [130, 131].map((id) => ({ label: `product page ${id}`, url: `https://matha.site/p/${id}/`, browser, bots: {}, gate: gate?.reason }));
      const samples = [130, 131].map((id) => ({ url: `https://matha.site/p/${id}/`, product: { ...product, id } }));
      const f = checkStructuredData(schemaPagesFrom(samples, accessPages), "MAD");
      expect(f.map((x) => `${x.finding_key}/${x.basis}`)).toEqual(["schema_unavailable:130/unavailable", "schema_unavailable:131/unavailable"]);
      expect(f[0].evidence).toContain("Coming soon");
      expect(f[0].evidence).toContain("HTTP 200");
    }
  });

  it("records what the page had when a live page has no Product data", () => {
    const [f] = checkStructuredData(schemaPagesFrom([{ url: "https://matha.site/p/1/", product }], [{ label: "product page 1", url: "https://matha.site/p/1/", browser: page(200, "<title>Tea</title>"), bots: {} }]), "MAD");
    expect(f.type).toBe("schema_product_missing");
    expect(f.evidence).toContain('Page: HTTP 200, title "Tea", coming-soon meta: no, coming-soon block: no');
  });
});
