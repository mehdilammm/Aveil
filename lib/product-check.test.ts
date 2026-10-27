import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fixtures/fake-supabase";

vi.mock("server-only", () => ({}));
let plan = "pro";
const applied: unknown[] = [];
vi.mock("./orders-sync", () => ({ planOf: async () => plan }));
// matha.site product 171: no image, no brand, no GTIN (its real state in the last scan, plus no brand).
const product = { id: 171, name: "Rectangular Wall Mirror 80 x 120 cm", type: "simple", price: "500", regular_price: "500", sale_price: "", description: "A rectangular wall mirror 80 x 120 cm with a thin black metal frame, for an entrance or a bedroom.", images: [], virtual: false, weight: "6", permalink: "https://matha.site/product/rectangular-wall-mirror-80-x-120-cm/", stock_status: "instock", sku: "", global_unique_id: "", brands: [], attributes: [] };
vi.mock("./woo", async (orig) => ({ ...(await orig<typeof import("./woo")>()), fetchPublishedProduct: async () => product }));
vi.mock("./platform/woocommerce", () => ({ wooCommerceAdapter: () => ({ fetchVariations: async () => [], fetchProductSchema: async (url: string) => ({ url, page: { ok: false, error: "not loaded in the test" } }) }) }));
vi.mock("./autofix", () => ({
  fixContext: async () => ({}),
  planAuto: (_c: unknown, fs: { finding_key: string; type: string }[]) => fs.filter((f) => f.type === "feed_brand_missing").map((f) => ({ finding: f, type: "auto", kind: "brand", ready: true, reason: null, describe: "brand" })),
  applyFixes: async (_a: unknown, _c: unknown, items: unknown[]) => (applied.push(...items), { batchId: "b1", results: items.map(() => ({ status: "applied", describe: "Brand \"Matha\" set on product #171", verify: "resolved" })) }),
}));

const db = (autoFix: boolean) => fakeSupabase(
  { stores: [{ id: "s1", auto_fix_enabled: autoFix }], store_alerts: [] },
  { get_store_credentials: () => ({ consumer_key: "ck", consumer_secret: "cs" }), get_traffic_connector_secret: () => null },
);
const store = { id: "s1", owner_id: "u1", url: "https://matha.site", workspace_id: "w1" };

describe("instant check on publish (F3)", () => {
  beforeEach(() => {
    applied.length = 0;
    plan = "pro";
  });

  it("Pro with auto-fix on: checks the product, applies its auto fixes and says so", async () => {
    const { productCheck } = await import("./store-checks");
    const d = db(true);
    const r = await productCheck(d.client, store, 171, "j1", ["e1"]);
    expect(r).toMatchObject({ fixed: 1 });
    expect(applied).toHaveLength(1);
    const alert = d.tables.store_alerts[0];
    expect(alert).toMatchObject({ kind: "product_check", job_id: "j1", event_ids: ["e1"] });
    expect(String(alert.title)).toMatch(/^Rectangular Wall Mirror 80 x 120 cm: \d+ issues, 1 fixed automatically$/);
    const detail = alert.detail as { issues: { title: string }[]; auto_fix: string };
    expect(detail.auto_fix).toBe("on");
    expect(detail.issues.map((i) => i.title)).toContain("No featured image");
  });

  it("Free: the same check, nothing applied, and the notice says auto-fix needs Pro", async () => {
    plan = "free";
    const { productCheck } = await import("./store-checks");
    const d = db(true);
    await productCheck(d.client, store, 171, "j2", []);
    expect(applied).toHaveLength(0);
    expect((d.tables.store_alerts[0].detail as { auto_fix: string; fixed: unknown[] })).toMatchObject({ auto_fix: "plan", fixed: [] });
  });
});
