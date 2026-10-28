import { beforeEach, describe, expect, it, vi } from "vitest";
import { storedAlt } from "./alt-text";
import { fakeSupabase } from "./fixtures/fake-supabase";

vi.mock("server-only", () => ({}));

// A small WooCommerce that behaves like its REST API (WooCommerce 11.2.1 source, read 2026-10-28): the first image
// sent becomes the featured one, an alt text is written only when !empty() and stored through wc_clean().
type P = { id: number; name: string; type: string; featured: number; gallery: number[]; variations: { id: number; image: number; attributes: { name: string; option: string }[] }[] };
let products: P[] = [];
const alts = new Map<number, string>();
const writes: { path: string; body: unknown }[] = [];
const view = (p: P) => ({ id: p.id, name: p.name, type: p.type, images: [...(p.featured ? [p.featured] : []), ...p.gallery].map((id) => ({ id, src: `https://matha.site/${id}.png`, alt: alts.get(id) ?? "" })) });
const setAlt = (id: number, alt?: string) => {
  if (alt) alts.set(id, storedAlt(alt));
};
vi.mock("./woo", async (orig) => ({
  ...(await orig<typeof import("./woo")>()),
  fetchPublishedProduct: async (_u: string, _c: unknown, id: number) => {
    const p = products.find((x) => x.id === id);
    return p ? view(p) : null;
  },
  fetchPublishedProducts: async () => ({ items: products.map(view), total: products.length, totalPages: 1, truncated: false }),
  fetchPublishedVariations: async (_u: string, id: number) =>
    products.find((x) => x.id === id)!.variations.map((v) => ({ id: v.id, price: "1", regular_price: "1", sale_price: "", virtual: false, weight: "1", attributes: v.attributes, image: { id: v.image || products.find((x) => x.id === id)!.featured, alt: alts.get(v.image || products.find((x) => x.id === id)!.featured) ?? "" } })),
  fetchFeaturedMedia: async (_u: string, id: number) => ({ ok: true, data: products.find((x) => x.id === id)!.featured }),
  wooWrite: async (_u: string, _m: string, path: string, body: { images?: { id: number; alt?: string }[]; image?: { id: number; alt?: string } }) => {
    writes.push({ path, body });
    const parts = path.split("/");
    const p = products.find((x) => x.id === Number(parts[2]))!;
    if (body.images) {
      p.featured = body.images[0]?.id ?? 0;
      p.gallery = body.images.slice(1).map((i) => i.id);
      for (const i of body.images) setAlt(i.id, i.alt);
    }
    if (body.image) {
      p.variations.find((v) => v.id === Number(parts[4]))!.image = body.image.id;
      setAlt(body.image.id, body.image.alt);
    }
    return {};
  },
}));
vi.mock("./plugin-client", () => ({ callPlugin: async () => ({ plugin_version: "1.8.0", done: [], applied: [], environment: {} }) }));
vi.mock("./verify-run", () => ({ verifyOnce: async () => ({ status: "resolved", evidence: "gone" }) }));

const { applyFixes, planAuto, revertFix } = await import("./autofix");
const { altFindings, altProductOf } = await import("./alt-text");
const { imageUse } = await import("./alt-text-run");
let n = 0;
const store = () => ({ id: `s${++n}`, owner_id: "u1", url: "https://matha.site" }); // a new store id: no cached image index
const ctx = (s = store(), altText = true, write = true) => ({ store: s, read: { consumerKey: "ck", consumerSecret: "cs" }, write: write ? { consumerKey: "ckw", consumerSecret: "csw" } : null, pluginToken: "t", altText });
const finding = (pid: number) => ({ finding_key: `image_alt_missing:${pid}`, type: "image_alt_missing", evidence: "", product_id: pid });
const item = (pid: number) => ({ finding: finding(pid), type: "auto" as const, kind: "alt_text" as const });

beforeEach(() => {
  writes.length = 0;
  alts.clear();
  // matha.site's sharing (172 shows 176's and 177's photos) plus a product with an image without alt text.
  products = [
    { id: 172, name: "Laser Engraved LED Mirror 80 x 120 cm", type: "simple", featured: 1001, gallery: [1002, 1003], variations: [] },
    { id: 176, name: "Moroccan Pattern Laser Engraved LED Mirror", type: "simple", featured: 1002, gallery: [], variations: [] },
    { id: 177, name: "Leaf Laser Engraved LED Mirror", type: "simple", featured: 1003, gallery: [], variations: [] },
    { id: 300, name: "Oval Bathroom Mirror", type: "simple", featured: 3001, gallery: [3002], variations: [] },
    { id: 400, name: "Round LED Mirror", type: "variable", featured: 4000, gallery: [], variations: [{ id: 401, image: 4001, attributes: [{ name: "Size", option: "60 cm" }] }, { id: 402, image: 0, attributes: [{ name: "Size", option: "80 cm" }] }] },
  ];
  for (const [id, alt] of [[1001, "Greek key laser engraved LED mirror above a bathroom sink"], [1003, "Leaf laser engraved LED mirror"], [3002, "The merchant's own words"]] as const) alts.set(id, alt);
});

describe("G4 image alt text: write key", () => {
  it("is ready only with the write key and the store's opt-in", () => {
    expect(planAuto(ctx(), [finding(300)])[0]).toMatchObject({ kind: "alt_text", ready: true });
    expect(planAuto(ctx(store(), false), [finding(300)])[0]).toMatchObject({ ready: false, reason: expect.stringContaining("Image alt text is off") });
    expect(planAuto(ctx(store(), true, false), [finding(300)])[0]).toMatchObject({ ready: false, reason: expect.stringContaining("write key") });
  });

  it("writes only the empty alt text, keeps the images and their order, logs before / after, and undo empties only its own", async () => {
    const { client, tables } = fakeSupabase();
    const c = ctx();
    const r = await applyFixes(client, c, [item(300)], { userId: null, automatic: true });
    expect(r.results[0]).toMatchObject({ status: "applied", describe: 'Alt text written on 1 image of product #300: "Oval Bathroom Mirror"' });
    expect(writes).toEqual([{ path: "/products/300", body: { images: [{ id: 3001, alt: "Oval Bathroom Mirror" }, { id: 3002 }] } }]);
    expect(products.find((p) => p.id === 300)).toMatchObject({ featured: 3001, gallery: [3002] });
    expect(alts.get(3001)).toBe("Oval Bathroom Mirror");
    expect(alts.get(3002)).toBe("The merchant's own words");
    const row = tables.fix_audit_log[0];
    expect(row).toMatchObject({ kind: "alt_text", channel: "write_key", target: "product:300", before: { alt: [{ image: 3001, variation: null, alt: "" }] }, after: { alt: [{ image: 3001, variation: null, alt: "Oval Bathroom Mirror" }] } });
    // The verify check finds nothing left for this product.
    expect(altFindings([altProductOf(view(products.find((p) => p.id === 300)!), [])], await imageUse(c.store, c.read))).toEqual([]);

    writes.length = 0;
    expect(await revertFix(client, c, String(row.id), "u1")).toEqual({ ok: true });
    expect(writes).toEqual([{ path: "/products/300", body: { images: [{ id: 3001, alt: " " }, { id: 3002 }] } }]);
    expect(alts.get(3001)).toBe("");
    expect(alts.get(3002)).toBe("The merchant's own words");
    expect(tables.fix_audit_log[0]).toMatchObject({ status: "reverted" });
  });

  it("undo leaves alt text the merchant changed since", async () => {
    const { client, tables } = fakeSupabase();
    const c = ctx();
    await applyFixes(client, c, [item(300)], { userId: null, automatic: true });
    alts.set(3001, "Oval mirror in a white bathroom");
    writes.length = 0;
    expect(await revertFix(client, c, String(tables.fix_audit_log[0].id), "u1")).toEqual({ ok: true });
    expect(writes).toEqual([]);
    expect(alts.get(3001)).toBe("Oval mirror in a white bathroom");
  });

  it("a variable product: the variation's own image gets its options, the parent image (also shown by a variation) the name", async () => {
    const { client } = fakeSupabase();
    const r = await applyFixes(client, ctx(), [item(400)], { userId: null, automatic: true });
    expect(r.results[0].status).toBe("applied");
    expect(writes).toEqual([
      { path: "/products/400", body: { images: [{ id: 4000, alt: "Round LED Mirror" }] } },
      { path: "/products/400/variations/401", body: { image: { id: 4001, alt: "Round LED Mirror – Size: 60 cm" } } },
    ]);
    expect(products.find((p) => p.id === 400)!.variations.map((v) => v.image)).toEqual([4001, 0]);
  });

  it("matha.site's shared photo without alt text is not written (it is on 172 and 176)", async () => {
    const { client, tables } = fakeSupabase();
    const r = await applyFixes(client, ctx(), [item(176)], { userId: null, automatic: true });
    expect(r.results[0]).toMatchObject({ status: "failed", error: "Nothing can be written: image #1002 is used by products #172, #176." });
    expect(writes).toEqual([]);
    expect(tables.fix_audit_log[0]).toMatchObject({ status: "failed", before: null, after: null });
  });

  it("a product with gallery images but no featured image is not written (WooCommerce would make the first one featured)", async () => {
    products.find((p) => p.id === 300)!.featured = 0;
    products.find((p) => p.id === 300)!.gallery = [3001, 3002];
    const { client } = fakeSupabase();
    const r = await applyFixes(client, ctx(), [item(300)], { userId: null, automatic: true });
    expect(r.results[0].status).toBe("failed");
    expect(r.results[0].error).toContain("no featured image");
    expect(writes).toEqual([]);
  });
});
