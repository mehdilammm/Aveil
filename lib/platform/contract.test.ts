import { describe, expect, it, vi } from "vitest";
import catalog from "../fixtures/matha-catalog-2026-10-22.json";
import checkout from "../fixtures/matha-2026-10-23.json";
import { WRITES_DISABLED, type StorePlatformAdapter } from "./adapter";
import type { WooDeps } from "./woocommerce";

vi.mock("server-only", () => ({}));

const { wooCommerceAdapter } = await import("./woocommerce");

// The contract every platform adapter must meet, run against each adapter with recorded platform answers.
function contract(name: string, make: (opts: { failing?: boolean }) => StorePlatformAdapter) {
  describe(`StorePlatformAdapter contract: ${name}`, () => {
    it("products: ids, names and a total that matches the list when not truncated", async () => {
      const r = await make({}).fetchProducts();
      expect(r.items.length).toBeGreaterThan(0);
      for (const p of r.items) expect(typeof p.id === "number" && typeof p.name === "string").toBe(true);
      if (!r.truncated) expect(r.total).toBe(r.items.length);
      const page = await make({}).fetchProductsPage(1);
      expect(page.totalPages).toBeGreaterThanOrEqual(1);
      expect(page.items.length).toBeLessThanOrEqual(100);
    });

    it("categories and attributes come back as a Source: data, or a reason", async () => {
      const a = make({});
      for (const s of [await a.fetchCategories(), await a.fetchAttributes()]) {
        expect(s.ok ? Array.isArray(s.data) : typeof s.reason === "string" && s.reason.length > 0).toBe(true);
      }
      const broken = make({ failing: true });
      const c = await broken.fetchCategories();
      expect(c.ok).toBe(false);
      if (!c.ok) expect(c.reason).toMatch(/categories/);
    });

    it("policies: settings, pages, site name and Coming soon are each a Source", async () => {
      const p = await make({}).fetchPolicies();
      for (const s of [p.settings, p.pages, p.siteName, p.comingSoon]) expect(typeof s.ok).toBe("boolean");
    });

    it("ownership: verified only with evidence, otherwise the reason", async () => {
      const ok = await make({}).verifyOwnership();
      expect(ok).toMatchObject({ verified: true, method: "api_key" });
      expect(ok.evidence.length).toBeGreaterThan(10);
      const no = await make({ failing: true }).verifyOwnership();
      expect(no.verified).toBe(false);
      expect(no.method).toBeNull();
      expect(no.evidence).toMatch(/rejected/);
    });

    it("never writes to the store: applyFix and revertFix refuse with the reason", async () => {
      const a = make({});
      expect(await a.applyFix({ fixId: "f1", kind: "jsonld", target: "product:1", payload: {} })).toEqual({ ok: false, reason: WRITES_DISABLED });
      expect(await a.revertFix("f1")).toEqual({ ok: false, reason: WRITES_DISABLED });
    });
  });
}

function wooDeps(failing: boolean): WooDeps {
  const deps = {
    fetchPublishedProducts: async () => ({ items: catalog.products as never[], total: catalog.products.length, totalPages: 1, truncated: false }),
    fetchPublishedProductsPage: async () => ({ items: catalog.products as never[], total: catalog.products.length, totalPages: 1 }),
    fetchPublishedVariations: async () => [],
    fetchCategories: async () => (failing ? { ok: false as const, reason: "Product categories could not be read: HTTP 500." } : { ok: true as const, data: catalog.categories }),
    fetchAttributes: async () => ({ ok: true as const, data: catalog.attributes }),
    fetchSettings: async () => ({ ok: true as const, data: { woocommerce_enable_guest_checkout: checkout.guest_checkout } }),
    fetchPublicPages: async () => ({ ok: true as const, data: [] }),
    fetchSiteName: async () => ({ ok: true as const, data: "Matha" }),
    fetchComingSoon: async () => ({ ok: true as const, data: { comingSoon: false, storePagesOnly: false } }),
    fetchPublicPage: async () => ({ ok: false as const, error: "not used" }),
    runAccessCheck: async () => ({ findings: [], pages: [], gated: [] }),
    verifyReadKey: async () => (failing ? { ok: false as const, reason: "WooCommerce rejected the API key. Check it is correct and has Read access." } : { ok: true as const, data: true as const }),
    fetchShippingZones: async () => ({ ok: true as const, data: checkout.zones }),
    fetchPaymentGateways: async () => ({ ok: true as const, data: checkout.gateways }),
  };
  return deps as unknown as WooDeps;
}

contract("WooCommerce (matha.site answers)", ({ failing }) => wooCommerceAdapter("https://matha.site", { consumerKey: "ck", consumerSecret: "cs" }, wooDeps(Boolean(failing))));

describe("WooCommerce adapter passes the store's own data through unchanged", () => {
  it("13 published products, 4 categories, no global attributes, checkout setup", async () => {
    const a = wooCommerceAdapter("https://matha.site", { consumerKey: "ck", consumerSecret: "cs" }, wooDeps(false));
    expect((await a.fetchProducts()).items.map((p) => p.id)).toEqual(catalog.products.map((p) => p.id));
    const cats = await a.fetchCategories();
    expect(cats.ok && cats.data.map((c) => c.name)).toEqual(["Laser Engraved Mirrors", "LED Mirrors", "Plain Mirrors", "Uncategorized"]);
    expect(await a.fetchAttributes()).toEqual({ ok: true, data: [] });
    const setup = await a.fetchCheckoutSetup();
    expect(setup.gateways.ok && setup.gateways.data.filter((g) => g.enabled).map((g) => g.id)).toEqual(["cod"]);
  });
});
