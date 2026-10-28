import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fixtures/fake-supabase";

vi.mock("server-only", () => ({}));
let pluginVersion = "1.8.0";
let plan = "pro";
const calls: { action: string; fixes?: { id: string; kind: string; payload: Record<string, string> }[]; ids?: string[] }[] = [];
vi.mock("./plugin-client", () => ({
  callPlugin: async (_u: string, _t: string, payload: (typeof calls)[number]) => {
    calls.push(payload);
    const takes = pluginVersion >= "1.8.0";
    return { plugin_version: pluginVersion, done: payload.action === "apply" && takes ? (payload.fixes ?? []).map((f) => ({ id: f.id })) : [], applied: [], environment: { robots_file: false, llms_file: false, woocommerce: true } };
  },
}));
vi.mock("./orders-sync", () => ({ planOf: async () => plan }));
vi.mock("./verify-run", () => ({ verifyOnce: async () => ({ status: "resolved", evidence: "served" }) }));
let products = 1;
vi.mock("./feed-run", async () => {
  const { buildFeed } = await import("./feed-build");
  return {
    buildStoreFeed: async () => buildFeed({
      feedId: "agentscope-c2ab0cfe", storeUrl: "https://matha.site", siteName: "Matha Mirrors", currency: "MAD", country: "MA", variations: {}, categories: [], links: [], now: new Date("2026-10-28T09:00:00Z"),
      products: products ? [{ id: 174, name: "Round LED Mirror", type: "simple", status: "publish", permalink: "https://matha.site/product/round-led-mirror/", description: "<p>Round LED mirror.</p>", price: "800", regular_price: "800", sale_price: "", stock_status: "instock", images: [] }] : [],
    }),
  };
});

const { applyFixes, planAuto, revertFix } = await import("./autofix");
const { enqueueFeedRefresh, refreshFeed } = await import("./feed-jobs");
const { checkFeedServed } = await import("./feed-build");
const store = { id: "s1", owner_id: "u1", url: "https://matha.site", workspace_id: "w1" };
const ctx = (plugin = true) => ({ store, read: { consumerKey: "ck", consumerSecret: "cs" }, write: null, pluginToken: plugin ? "agsc_t" : null });
const finding = { finding_key: "feed:not_served", type: "feed_not_served", evidence: "", product_id: null };

beforeEach(() => {
  calls.length = 0;
  pluginVersion = "1.8.0";
  plan = "pro";
  products = 1;
});

describe("product feed fix (G1)", () => {
  it("is an auto fix that needs plugin 1.8.0", () => {
    expect(planAuto(ctx(), [finding])[0]).toMatchObject({ type: "auto", kind: "feed", ready: true });
    expect(planAuto(ctx(false), [finding])[0]).toMatchObject({ ready: false, reason: "Needs the AgentScope Core plugin 1.8.0 or later, connected to the app." });
  });

  it("applied: the feed goes to the plugin signed, the audit log keeps counts (not the files), verified; undo removes it", async () => {
    const { client, tables } = fakeSupabase();
    const r = await applyFixes(client, ctx(), [{ finding, type: "auto", kind: "feed" }], { userId: null, automatic: true });
    expect(r.results[0]).toMatchObject({ status: "applied", verify: "resolved", describe: "Product feed served: 1 products, 1 variants (0 left out); CSV 0 rows" });
    const sent = calls[0].fixes![0];
    expect(sent.kind).toBe("feed");
    expect(JSON.parse(sent.payload.metadata)).toEqual({ id: "agentscope-c2ab0cfe", target_country: "MA", updated_at: "2026-10-28T09:00:00Z" });
    expect(sent.payload.jsonl.trim().split("\n")).toHaveLength(1);
    const row = tables.fix_audit_log[0];
    expect(row).toMatchObject({ fix_type: "auto", kind: "feed", channel: "plugin", target: "/agentscope-feed/products.jsonl", status: "applied", automatic: true });
    expect(row.after).toMatchObject({ fix_id: sent.id, spec: "ACP product feed 2026-04-17", counts: { products: 1, csvRows: 0 } });
    expect(JSON.stringify(row.after)).not.toContain("Round LED Mirror");
    expect(await revertFix(client, ctx(), String(row.id), "u1")).toEqual({ ok: true });
    expect(calls.at(-1)).toEqual({ action: "revert", ids: [sent.id] });
  });

  it("refused before anything is written: plugin 1.7.0, Free plan, no product to list", async () => {
    const { client, tables } = fakeSupabase();
    pluginVersion = "1.7.0";
    const old = await applyFixes(client, ctx(), [{ finding, type: "auto", kind: "feed" }], { userId: "u1", automatic: false });
    expect(old.results[0]).toMatchObject({ status: "failed", error: "The plugin did not take the feed (plugin 1.7.0; the feed needs 1.8.0 or later)." });
    pluginVersion = "1.8.0";
    plan = "free";
    const free = await applyFixes(client, ctx(), [{ finding, type: "auto", kind: "feed" }], { userId: "u1", automatic: false });
    expect(free.results[0]).toMatchObject({ status: "failed", error: "Unavailable: needs Pro plan." });
    plan = "pro";
    products = 0;
    const none = await applyFixes(client, ctx(), [{ finding, type: "auto", kind: "feed" }], { userId: "u1", automatic: false });
    expect(none.results[0].error).toMatch(/^No product can be listed in the feed/);
    expect(tables.fix_audit_log.map((r) => r.status)).toEqual(["failed", "failed", "failed"]);
    expect(tables.fix_audit_log.every((r) => r.channel === "plugin")).toBe(true);
  });

  it("refresh: only for a store with an applied feed, same fix id, one queued job at a time", async () => {
    const { client, tables } = fakeSupabase({ stores: [store], fix_audit_log: [], jobs: [] }, {
      get_store_credentials: () => ({ consumer_key: "ck", consumer_secret: "cs" }),
      get_store_write_credentials: () => null,
      get_traffic_connector_secret: () => ({ token: "agsc_t" }),
    });
    expect(await refreshFeed(client, store)).toEqual({ skipped: "no feed applied" });
    expect(await enqueueFeedRefresh(client, store, 120)).toBeNull();
    tables.fix_audit_log.push({ id: "a1", store_id: "s1", kind: "feed", status: "applied", applied_at: "2026-10-28T09:00:00Z", after: { fix_id: "11111111-2222-4333-8444-555555555555" } });
    const r = await refreshFeed(client, store);
    expect(r).toMatchObject({ audit_id: "a1", counts: { products: 1 } });
    expect(calls.at(-1)!.fixes![0].id).toBe("11111111-2222-4333-8444-555555555555");
    const job = await enqueueFeedRefresh(client, store, 120);
    tables.jobs[0].status = "queued";
    expect(await enqueueFeedRefresh(client, store, 120)).toBe(job);
    expect(tables.jobs).toHaveLength(1);
    expect(tables.jobs[0]).toMatchObject({ kind: "feed_refresh", store_id: "s1", max_attempts: 3 });
  });

  it("served or not, as the scan and the verify see it", () => {
    const ok = checkFeedServed("https://matha.site", { ok: true, data: { status: 200, text: '{"id":"174","variants":[{"id":"174","title":"Round LED Mirror"}]}\n' } });
    expect(ok).toEqual([]);
    expect(checkFeedServed("https://matha.site", { ok: true, data: { status: 404, text: "" } })[0]).toMatchObject({ type: "feed_not_served", basis: "observed", evidence: "https://matha.site/agentscope-feed/products.jsonl answered HTTP 404." });
    expect(checkFeedServed("https://matha.site", { ok: true, data: { status: 200, text: "<!doctype html><p>Shop</p>" } })[0].type).toBe("feed_not_served");
    expect(checkFeedServed("https://matha.site", { ok: false, reason: "timeout" })[0]).toMatchObject({ type: "feed_check_unavailable", basis: "unavailable" });
  });
});
