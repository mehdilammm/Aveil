import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// WooCommerce answers by path, as the REST API returns them (HTML entities in names included).
const answers: Record<string, { body: unknown; status?: number }> = {
  "/wp-json/wc/v3/products/categories": { body: [{ id: 28, name: "Laser Engraved &amp; LED", parent: 0, count: 4 }, { id: 26, name: "Uncategorized", parent: 0, count: 0 }] },
  "/wp-json/wc/v3/products/attributes": { body: [{ id: 1, name: "Size", slug: "pa_size" }] },
  "/wp-json/wc/v3/products/attributes/1/terms": { body: [{ name: "80 x 120 cm" }, { name: "60 &amp; 90" }] },
  "/wp-json/wc/v3/products": { body: [{ id: 170 }] },
};
const seen: URL[] = [];
let status = 200;
vi.mock("./safe-fetch", () => ({
  BlockedUrlError: class extends Error {},
  guardedFetch: async (url: URL) => {
    seen.push(url);
    const a = answers[url.pathname];
    return new Response(JSON.stringify(a?.body ?? []), { status: a ? status : 404, headers: { "x-wp-total": "2", "x-wp-totalpages": "1" } });
  },
}));

const { fetchAttributes, fetchCategories, verifyReadKey } = await import("./woo");
const creds = { consumerKey: "ck_x", consumerSecret: "cs_x" };

describe("WooCommerce catalog reads", () => {
  it("categories: id, decoded name, parent, count; only those fields are asked for", async () => {
    expect(await fetchCategories("https://shop.test", creds)).toEqual({ ok: true, data: [{ id: 28, name: "Laser Engraved & LED", parent: 0, count: 4 }, { id: 26, name: "Uncategorized", parent: 0, count: 0 }] });
    expect(seen.at(-1)!.searchParams.get("_fields")).toBe("id,name,parent,count");
  });

  it("attributes with their terms", async () => {
    expect(await fetchAttributes("https://shop.test", creds)).toEqual({ ok: true, data: [{ id: 1, name: "Size", slug: "pa_size", terms: ["80 x 120 cm", "60 & 90"] }] });
  });

  it("a refused key gives the reason, not an empty list", async () => {
    status = 403;
    const c = await fetchCategories("https://shop.test", creds);
    expect(c).toEqual({ ok: false, reason: "This API key is not allowed to read product categories." });
    const v = await verifyReadKey("https://shop.test", creds);
    expect(v.ok).toBe(false);
    status = 200;
    expect(await verifyReadKey("https://shop.test", creds)).toEqual({ ok: true, data: true });
  });
});
