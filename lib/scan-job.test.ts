import { beforeEach, describe, expect, it, vi } from "vitest";
import catalog from "./fixtures/matha-catalog-2026-10-22.json";
import { fakeSupabase } from "./fixtures/fake-supabase";

vi.mock("server-only", () => ({}));

// The store's answers: matha.site's real catalog, one product page each with WooCommerce's JSON-LD.
let refuseKey = false;
let pageCalls = 0;
const productPage = (id: number, url: string) =>
  `<html><head><title>p</title></head><body>shop<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org/", "@graph": [{ "@type": "Product", "@id": `${url}#product`, name: `P${id}`, image: "x.jpg", offers: [{ "@type": "Offer", price: catalog.products.find((p) => p.id === id)?.price || "1", priceCurrency: "MAD", availability: "https://schema.org/InStock" }] }] })}</script></body></html>`;
const page = (url: string) => ({ ok: true as const, status: 200, finalUrl: url, redirectedTo: null, bytes: 100, body: productPage(catalog.products.find((p) => url.includes(p.permalink.split("/")[4]))?.id ?? 0, url), challengeHeader: false });

vi.mock("./platform/woocommerce", () => ({
  wooCommerceAdapter: () => ({
    fetchProductsPage: async (n: number) => {
      pageCalls++;
      if (refuseKey) {
        const { WooError } = await import("./woo");
        throw new WooError("WooCommerce rejected the API key. Check it is correct and has Read access.", 401);
      }
      const all = catalog.products;
      return { items: (n === 1 ? all.slice(0, 7) : all.slice(7)) as never[], total: all.length, totalPages: 2 };
    },
    fetchVariations: async () => [],
    fetchPolicies: async () => ({
      settings: { ok: true, data: { woocommerce_currency: "MAD", woocommerce_checkout_page_id: "0" } },
      pages: { ok: true, data: [] },
      siteName: { ok: true, data: "Matha" },
      comingSoon: { ok: true, data: { comingSoon: false, storePagesOnly: false } },
    }),
    checkBotAccess: async (urls: string[]) => ({ findings: [], gated: [], pages: urls.map((u) => ({ label: "product page", url: u, browser: page(u), bots: {} })) }),
    fetchCheckoutSetup: async () => ({ zones: { ok: true, data: [] }, gateways: { ok: true, data: [{ id: "cod", title: "COD", enabled: true }] } }),
    fetchProductSchema: async (url: string) => ({ url, page: page(url) }),
  }),
}));
vi.mock("node:dns", () => ({ promises: { resolveNs: async () => { throw Object.assign(new Error("no network in tests"), { code: "ENOTFOUND" }); } } }));
vi.mock("./agent-checks", () => ({ runStructuredChecks: async () => [], fetchText: async () => ({ ok: true, data: { status: 404, text: "" } }) }));
let plan = "free";
vi.mock("./orders-sync", () => ({ planOf: async () => plan, syncOrders: async () => ({}) }));
const autoFix = vi.fn(async () => ({ applied: 1 }));
vi.mock("./autofix-run", () => ({ runAutoFix: (...a: unknown[]) => autoFix(...(a as [])) }));
vi.mock("./ownership-store", () => ({ recordVerification: vi.fn(async () => {}) }));
vi.mock("./woo", async (orig) => ({ ...(await orig<typeof import("./woo")>()), fetchPublicPage: async (u: string) => page(u), fetchActivePlugins: async () => ({ ok: true, data: [] }) }));

const { runClaimedJob } = await import("./jobs");
const { JOB_HANDLERS } = await import("./job-handlers");

function db() {
  return fakeSupabase(
    { stores: [{ id: "s1", owner_id: "u1", url: "https://matha.site", workspace_id: "w1" }], jobs: [{ id: "j1", store_id: "s1", kind: "scan", status: "running", attempt: 1, max_attempts: 3, progress: { trigger: "manual" } }] },
    { get_store_credentials: () => ({ consumer_key: "ck", consumer_secret: "cs" }), get_traffic_connector_secret: () => null },
    { job_steps: ["job_id", "step_key"], scan_schema_pages: ["scan_id", "product_id"] },
  );
}
const job = (attempt = 1) => ({ id: "j1", workspace_id: "w1", store_id: "s1", kind: "scan", attempt, max_attempts: 3, progress: { trigger: "manual" } });

beforeEach(() => {
  refuseKey = false;
  pageCalls = 0;
});

describe("scan as a background job", () => {
  it("runs every step: 2 product pages, store checks, the Free sample of 5 pages (2 + 3), finish", async () => {
    const { client, tables } = db();
    expect(await runClaimedJob(client, job(), JOB_HANDLERS, Date.now() + 600_000)).toBe("succeeded");
    expect(tables.job_steps.map((s) => s.step_key)).toEqual(["start", "products:page:1", "products:page:2", "store", "schema:0", "finish", "autofix"]);
    const scan = tables.scans[0];
    expect(scan).toMatchObject({ status: "complete", published_products: 13, scanned_products: 13, sampled_products: 5, sample_basis: "category_coverage", cost_usd_micros: 0 });
    // The sample's JSON-LD source: WooCommerce core, one Product per page.
    expect(tables.scan_schema_pages).toHaveLength(5);
    expect(tables.scan_schema_pages.every((r) => r.primary_source === "woocommerce" && r.duplicate === false)).toBe(true);
    // matha.site's product 173 has no price: found once, with its state set at the end.
    const price = tables.findings.filter((f) => f.product_id === 173 && String(f.type).startsWith("price"));
    expect(price).toHaveLength(1);
    expect(tables.findings.every((f) => f.state === "new")).toBe(true);
    expect(tables.jobs[0].progress).toMatchObject({ step: "done" });
  });

  it("yields when the tick's time is short, and the next tick continues without redoing steps", async () => {
    const { client, tables } = db();
    // Enough time for the product pages (90 s each) but not the store step (120 s).
    expect(await runClaimedJob(client, job(), JOB_HANDLERS, Date.now() + 100_000)).toBe("yield");
    expect(tables.jobs[0]).toMatchObject({ status: "queued", attempt: 0 });
    expect(tables.job_steps.map((s) => s.step_key)).toEqual(["start", "products:page:1", "products:page:2"]);
    expect(pageCalls).toBe(2);
    expect(await runClaimedJob(client, job(1), JOB_HANDLERS, Date.now() + 600_000)).toBe("succeeded");
    expect(tables.scans).toHaveLength(1); // the same scan, not a second one
    expect(pageCalls).toBe(2); // product pages were not read again
  });

  it("a retried step replaces its findings instead of adding them twice", async () => {
    const { client, tables } = db();
    await runClaimedJob(client, job(), JOB_HANDLERS, Date.now() + 600_000);
    const before = tables.findings.length;
    // Forget that the store step succeeded: it runs again on the next attempt.
    tables.job_steps = tables.job_steps.filter((s) => s.step_key !== "store" && s.step_key !== "finish");
    await runClaimedJob(client, job(2), JOB_HANDLERS, Date.now() + 600_000);
    expect(tables.findings.length).toBe(before);
  }, 20_000); // two full scans, each with the polite 1.5 s gap between page requests

  it("auto-fix runs after the scan only when the store turned it on, on a plan with auto-fix", async () => {
    const off = db();
    await runClaimedJob(off.client, job(), JOB_HANDLERS, Date.now() + 600_000);
    expect(autoFix).not.toHaveBeenCalled();
    const free = db();
    free.tables.stores[0].auto_fix_enabled = true;
    await runClaimedJob(free.client, job(), JOB_HANDLERS, Date.now() + 600_000);
    expect(autoFix).not.toHaveBeenCalled();
    expect(free.tables.job_steps.find((s) => s.step_key === "autofix")?.result).toEqual({ skipped: "plan" });
    const on = db();
    on.tables.stores[0].auto_fix_enabled = true;
    plan = "pro";
    await runClaimedJob(on.client, job(), JOB_HANDLERS, Date.now() + 600_000);
    expect(autoFix).toHaveBeenCalledTimes(1);
    expect(on.tables.job_steps.find((s) => s.step_key === "autofix")?.result).toEqual({ applied: 1 });
    plan = "free";
  }, 30_000);

  it("a refused API key fails the scan at once with WooCommerce's reason (no retries)", async () => {
    const { client, tables } = db();
    refuseKey = true;
    expect(await runClaimedJob(client, job(), JOB_HANDLERS, Date.now() + 600_000)).toBe("failed");
    expect(tables.scans[0]).toMatchObject({ status: "failed", error: "WooCommerce rejected the API key. Check it is correct and has Read access." });
    expect(tables.jobs[0]).toMatchObject({ status: "failed" });
    expect(tables.findings ?? []).toEqual([]);
  });
});
