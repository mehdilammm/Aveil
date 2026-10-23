import { beforeEach, describe, expect, it, vi } from "vitest";
import checkout from "./fixtures/matha-2026-10-23.json";
import catalog from "./fixtures/matha-catalog-2026-10-22.json";
import { fakeSupabase } from "./fixtures/fake-supabase";

vi.mock("server-only", () => ({}));
// matha.site's state: sells to all countries, ships to Morocco only; product 173 has no price.
const settings: Record<string, unknown> = { woocommerce_allowed_countries: "all", woocommerce_specific_allowed_countries: [] };
const writes: { method: string; path: string; body: unknown }[] = [];
let failWrites = false;
const pluginCalls: unknown[] = [];
vi.mock("./woo", async (orig) => ({
  ...(await orig<typeof import("./woo")>()),
  fetchSetting: async (_u: string, _g: string, id: string) => settings[id],
  fetchShippingZones: async () => ({ ok: true, data: checkout.zones }),
  fetchPublishedProduct: async (_u: string, _c: unknown, id: number) => ({ ...catalog.products.find((p) => p.id === id), images: [] }),
  fetchSiteName: async () => ({ ok: true, data: "Matha Mirrors" }),
  findBrands: async () => [{ id: 30, name: "Matha Mirrors" }],
  wooWrite: async (_u: string, method: string, path: string, body: { value?: unknown }) => {
    if (failWrites) throw new Error("WooCommerce refused the write key. Check it has Read/Write permission.");
    writes.push({ method, path, body });
    const id = path.split("/").pop()!;
    if (path.startsWith("/settings/")) settings[id] = body.value;
    return {};
  },
}));
vi.mock("./plugin-client", () => ({
  callPlugin: async (_u: string, _t: string, payload: { action: string }) => {
    pluginCalls.push(payload);
    return { plugin_version: "1.6.0", done: [], applied: [], environment: { robots_file: false, llms_file: false, woocommerce: true } };
  },
}));
vi.mock("./fixes/inputs", () => ({
  generatorInputs: async () => ({ robots: { text: "", status: 200, reason: null }, productPath: "/product/x/", unavailable: [], waf: {}, llms: { storeUrl: "https://matha.site", siteName: "Matha Mirrors", tagline: null, currency: "MAD", pages: [], categories: [], products: [] } }),
}));
vi.mock("./verify-run", () => ({ verifyOnce: async () => ({ status: "resolved", evidence: "gone" }) }));

const { applyFixes, planAuto, revertFix } = await import("./autofix");
const store = { id: "s1", owner_id: "u1", url: "https://matha.site" };
const ctx = (write = true, plugin = true) => ({ store, read: { consumerKey: "ck", consumerSecret: "cs" }, write: write ? { consumerKey: "ckw", consumerSecret: "csw" } : null, pluginToken: plugin ? "agsc_t" : null });
const finding = (finding_key: string, type: string, product_id: number | null = null) => ({ finding_key, type, evidence: "", product_id });

beforeEach(() => {
  writes.length = 0;
  pluginCalls.length = 0;
  failWrites = false;
  settings.woocommerce_allowed_countries = "all";
  settings.woocommerce_specific_allowed_countries = [];
});

describe("auto-fix engine", () => {
  it("preview: matha.site's llms.txt is the only auto fix; it needs the plugin", () => {
    const fs = [finding("llms_txt:missing", "llms_txt_missing"), finding("checkout:shipping_gap", "checkout_shipping_gap"), finding("price_missing:173", "price_missing", 173)];
    expect(planAuto(ctx(), fs).map((p) => [p.finding.finding_key, p.ready])).toEqual([["llms_txt:missing", true]]);
    expect(planAuto(ctx(true, false), fs)[0]).toMatchObject({ ready: false, reason: "Needs the AgentScope Core plugin 1.6.0 or later, connected to the app." });
  });

  it("one-click 'sell where you ship': before/after logged, verified, and undone back to the old values", async () => {
    const { client, tables } = fakeSupabase({ scans: [{ id: "scan1", store_id: "s1", status: "complete", created_at: "1" }] });
    const r = await applyFixes(client, ctx(), [{ finding: finding("checkout:shipping_gap", "checkout_shipping_gap"), type: "one_click", kind: "sell_where_ship" }], { userId: "u1", automatic: false });
    expect(r.results[0]).toMatchObject({ status: "applied", verify: "resolved", describe: "Selling locations set to where you ship: MA" });
    const row = tables.fix_audit_log[0];
    expect(row).toMatchObject({ fix_type: "one_click", channel: "write_key", before: { woocommerce_allowed_countries: "all", woocommerce_specific_allowed_countries: [] }, status: "applied", applied_by: "u1", automatic: false });
    expect(settings).toMatchObject({ woocommerce_allowed_countries: "specific", woocommerce_specific_allowed_countries: ["MA"] });
    expect(tables.finding_verifications[0]).toMatchObject({ finding_key: "checkout:shipping_gap", status: "resolved", scan_id: "scan1" });

    expect(await revertFix(client, ctx(), String(row.id), "u1")).toEqual({ ok: true });
    expect(settings).toMatchObject({ woocommerce_allowed_countries: "all", woocommerce_specific_allowed_countries: [] });
    expect(tables.fix_audit_log[0]).toMatchObject({ status: "reverted", reverted_by: "u1" });
  });

  it("input: the merchant's price is checked and written as given; a bad value writes nothing", async () => {
    const { client, tables } = fakeSupabase();
    const bad = await applyFixes(client, ctx(), [{ finding: finding("price_missing:173", "price_missing", 173), type: "input", kind: "price", value: "abc" }], { userId: "u1", automatic: false });
    expect(bad.results[0]).toMatchObject({ status: "failed" });
    expect(writes).toEqual([]);
    const ok = await applyFixes(client, ctx(), [{ finding: finding("price_missing:173", "price_missing", 173), type: "input", kind: "price", value: "900" }], { userId: "u1", automatic: false });
    expect(ok.results[0].status).toBe("applied");
    expect(writes).toEqual([{ method: "PUT", path: "/products/173", body: { regular_price: "900" } }]);
    expect(tables.fix_audit_log.at(-1)).toMatchObject({ before: { regular_price: "", sale_price: "" }, after: { regular_price: "900" } });
  });

  it("auto llms.txt goes through the signed plugin call; undo removes it there", async () => {
    const { client, tables } = fakeSupabase();
    const r = await applyFixes(client, ctx(), [{ finding: finding("llms_txt:missing", "llms_txt_missing"), type: "auto", kind: "llms_txt" }], { userId: null, automatic: true });
    expect(r.results[0].status).toBe("applied");
    const apply = pluginCalls.find((c) => (c as { action: string }).action === "apply") as { fixes: { kind: string; payload: { text: string } }[] };
    expect(apply.fixes[0].kind).toBe("llms_txt");
    expect(apply.fixes[0].payload.text).toBe("# Matha Mirrors\n");
    expect(tables.fix_audit_log[0]).toMatchObject({ channel: "plugin", automatic: true, applied_by: null });
    await revertFix(client, ctx(), String(tables.fix_audit_log[0].id), "u1");
    expect(pluginCalls.at(-1)).toMatchObject({ action: "revert" });
  });

  it("no write key, or a refused key: logged as failed with the reason, nothing changed", async () => {
    const { client, tables } = fakeSupabase();
    await applyFixes(client, ctx(false), [{ finding: finding("checkout:shipping_gap", "checkout_shipping_gap"), type: "one_click", kind: "sell_where_ship" }], { userId: "u1", automatic: false });
    expect(tables.fix_audit_log[0]).toMatchObject({ status: "failed" });
    expect(String(tables.fix_audit_log[0].error)).toContain("write key");
    failWrites = true;
    await applyFixes(client, ctx(), [{ finding: finding("checkout:guest_disabled", "checkout_guest_disabled"), type: "one_click", kind: "guest_checkout" }], { userId: "u1", automatic: false });
    expect(tables.fix_audit_log[1]).toMatchObject({ status: "failed", error: "WooCommerce refused the write key. Check it has Read/Write permission." });
  });
});
