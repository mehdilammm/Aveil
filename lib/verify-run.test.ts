import { describe, expect, it, vi } from "vitest";
import catalog from "./fixtures/matha-catalog-2026-10-22.json";

vi.mock("server-only", () => ({}));
let product: Record<string, unknown> | null = null;
let pageBody = "";
const seen: string[] = [];
vi.mock("./woo", async (orig) => ({
  ...(await orig<typeof import("./woo")>()),
  fetchPublishedProduct: async () => product,
  fetchPublicPage: async (url: string, _ua: string, _t: unknown, noCache: boolean) => {
    seen.push(`${url}|${noCache}`);
    return { ok: true, status: 200, finalUrl: url, redirectedTo: null, bytes: pageBody.length, body: pageBody, challengeHeader: false };
  },
}));
vi.mock("./platform/woocommerce", () => ({
  wooCommerceAdapter: () => ({
    fetchVariations: async () => [],
    fetchPolicies: async () => ({ settings: { ok: true, data: { woocommerce_currency: "MAD" } }, pages: { ok: true, data: [] }, siteName: { ok: true, data: "Matha" }, comingSoon: { ok: true, data: { comingSoon: false, storePagesOnly: false } } }),
  }),
}));
const { verifyOnce } = await import("./verify-run");
const admin = { rpc: () => ({ maybeSingle: async () => ({ data: null }) }) } as never;
const store = { id: "s1", owner_id: "u1", url: "https://matha.site" };
const creds = { consumerKey: "ck", consumerSecret: "cs" };
const p173 = catalog.products.find((p) => p.id === 173)!;

describe("targeted re-check on matha.site's product 173 (no price)", () => {
  it("price still missing → still open; price added → resolved (Observed)", async () => {
    product = { ...p173, description: "x".repeat(200), images: [{ id: 1, src: "a.jpg" }] };
    expect((await verifyOnce(admin, store, creds, { finding_key: "price_missing:173", type: "price_missing", product_id: 173 }, "t1")).status).toBe("still_open");
    product = { ...product, price: "900", regular_price: "900" };
    expect((await verifyOnce(admin, store, creds, { finding_key: "price_missing:173", type: "price_missing", product_id: 173 }, "t2")).status).toBe("resolved");
  });

  it("the product page is fetched with caches bypassed; JSON-LD now present → resolved", async () => {
    product = { ...p173, price: "900" };
    pageBody = `<html><head><title>x</title></head><body><script type="application/ld+json">{"@context":"https://schema.org/","@type":"Product","@id":"${p173.permalink}#product","name":"Custom","image":"a.jpg","offers":{"@type":"Offer","price":"900","priceCurrency":"MAD","availability":"https://schema.org/InStock"}}</script></body></html>`;
    const r = await verifyOnce(admin, store, creds, { finding_key: "schema_product_missing:173", type: "schema_product_missing", product_id: 173 }, "abc");
    expect(r.status).toBe("resolved");
    expect(seen.at(-1)).toBe(`${p173.permalink}?agsc_verify=abc|true`);
  });

  it("a product that is not published any more is not a fix", async () => {
    product = null;
    const r = await verifyOnce(admin, store, creds, { finding_key: "price_missing:173", type: "price_missing", product_id: 173 }, "t");
    expect(r).toEqual({ status: "unavailable", evidence: "Product #173 is not published any more, so the fix cannot be checked." });
  });
});
