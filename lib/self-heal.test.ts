import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fixtures/fake-supabase";
import { currentPluginFixes, healPlan, rollbackPlan, type AuditRow } from "./self-heal";

vi.mock("server-only", () => ({}));

// matha.site's fixes of 2026-10-28 19:10 (audit ids and payloads as recorded).
const NOW = Date.parse("2026-10-29T09:00:00Z");
const row = (id: string, kind: string, extra: Partial<AuditRow> = {}): AuditRow => ({
  id, finding_key: `jsonld:${kind}`, kind, channel: "plugin", target: `jsonld:${kind}`, status: "applied", applied_at: "2026-10-28T19:10:12Z", reapplied_of: null,
  after: { fix_id: id, payload: { type: "OnlineStore", telephone: "+212 637 037 640" }, describe: `${kind} fix` }, ...extra,
});
const matha = () => [
  row("2ee73133", "website"),
  row("d5017526", "shipping", { applied_at: "2026-10-28T19:10:16Z" }),
  row("ac68747c", "feed", { finding_key: "feed:not_served", target: "/agentscope-feed/products.jsonl", applied_at: "2026-10-28T19:10:19Z" }),
  row("006598d5", "org", { applied_at: "2026-10-28T19:10:22Z" }),
];
const all = (rows: AuditRow[]) => new Set(rows.map((r) => r.id));
const none = { keys: new Set<string>(), at: NOW };

describe("G9 self-healing: decisions", () => {
  it("every fix still stored and no finding back: nothing to do", () => {
    expect(healPlan(matha(), all(matha()), none, new Set(), NOW)).toEqual([]);
  });

  it("a fix the plugin no longer has is put back once; gone again after that: one alert, never a loop", () => {
    const rows = matha();
    const stored = new Set(["2ee73133", "d5017526", "ac68747c"]);
    expect(healPlan(rows, stored, none, new Set(), NOW).map((d) => [d.row.id, d.action, d.why])).toEqual([["006598d5", "reapply", "the plugin no longer has this fix"]]);
    rows.push(row("r1", "org", { status: "reapplied", reapplied_of: "006598d5", applied_at: "2026-10-29T09:00:00Z" }));
    // Gone again: lost (alert once), then nothing more.
    expect(healPlan(rows, stored, none, new Set(), NOW + 60_000).map((d) => d.action)).toEqual(["lost"]);
    expect(healPlan(rows, stored, none, new Set(["006598d5"]), NOW + 60_000)).toEqual([]);
  });

  it("a finding back counts only for fixes applied before the check started; within 24 h of a put-back it waits", () => {
    const rows = matha();
    const back = { keys: new Set(["jsonld:org"]), at: Date.parse("2026-10-28T19:09:00Z") };
    expect(healPlan(rows, all(rows), back, new Set(), NOW)).toEqual([]);
    const later = { keys: new Set(["jsonld:org"]), at: NOW };
    expect(healPlan(rows, all(rows), later, new Set(), NOW)[0]).toMatchObject({ action: "reapply", why: "the check finds the problem again" });
    rows.push(row("r1", "org", { status: "reapplied", reapplied_of: "006598d5", applied_at: new Date(NOW - 3_600_000).toISOString() }));
    expect(healPlan(rows, all(rows), later, new Set(), NOW)[0]).toMatchObject({ action: "wait" });
    expect(healPlan(rows, all(rows), later, new Set(), NOW + 86_400_000)[0]).toMatchObject({ action: "lost" });
  });

  it("never: undone fixes, failed ones, fixes replaced by a newer one of the same part, write-key fixes; nothing when the plugin cannot be asked", () => {
    const rows = [
      ...matha(),
      row("old-org", "org", { applied_at: "2026-10-27T10:00:00Z" }),
      row("undone", "returns", { status: "reverted" }),
      row("w1", "guest_checkout", { channel: "write_key", target: "settings:account", finding_key: "checkout:guest_disabled" }),
    ];
    expect(currentPluginFixes(rows).map((r) => r.id).sort()).toEqual(["006598d5", "2ee73133", "ac68747c", "d5017526"]);
    expect(healPlan(rows, new Set(), none, new Set(), NOW).map((d) => d.row.id).sort()).toEqual(["006598d5", "2ee73133", "ac68747c", "d5017526"]);
    expect(healPlan(rows, null, none, new Set(), NOW)).toEqual([]);
  });
});

describe("G9 with plugin 1.8.1: fixes the merchant removed in WordPress", () => {
  it("are never put back, whatever the finding says", () => {
    const rows = matha();
    const removed = new Map([["006598d5", Date.parse("2026-10-29T08:00:00Z")]]);
    const back = { keys: new Set(["jsonld:org"]), at: NOW };
    expect(healPlan(rows, new Set(["2ee73133", "d5017526", "ac68747c"]), back, new Set(), NOW, removed).map((d) => [d.row.id, d.action])).toEqual([["006598d5", "removed"]]);
  });
});

describe("G10 auto-rollback: decisions", () => {
  const problem = (type: string, evidence: string, product_id: number | null = 174) => ({ finding_key: `${type}:${product_id}`, type, title: "Structured data has errors", evidence, product_id });

  it("a new problem on the field of a recent fix points to it; older than 7 days or another field does not", () => {
    const rows = matha();
    expect(rollbackPlan(rows, [problem("schema_invalid", "offers[0].shippingDetails: shippingRate missing currency")], NOW).map((r) => r.row.id)).toEqual(["d5017526"]);
    expect(rollbackPlan(rows, [problem("schema_invalid", "offers[0].shippingDetails")], NOW + 8 * 86_400_000)).toEqual([]);
    expect(rollbackPlan(rows, [problem("schema_fields_missing", "no image")], NOW)).toEqual([]);
    expect(rollbackPlan(rows, [problem("access_blocked", "403 for GPTBot")], NOW)).toEqual([]);
  });

  it("product fixes only for their own product; each fix once", () => {
    const rows = [row("b1", "brand", { channel: "write_key", target: "product:171", finding_key: "feed_brand_missing:171" })];
    expect(rollbackPlan(rows, [problem("schema_invalid", "brand: not a Brand", 174)], NOW)).toEqual([]);
    expect(rollbackPlan(rows, [problem("schema_invalid", "brand: not a Brand", 171), problem("schema_invalid", "brand again", 171)], NOW)).toHaveLength(1);
  });
});

// The runners against a plugin and WooCommerce in memory.
const stored = new Map<string, Record<string, unknown>>();
const removedInWp: { id: string; kind: string; at: number }[] = [];
const settings: Record<string, unknown> = {};
const pluginCalls: { action: string; fixes?: { id: string; kind: string; payload: unknown }[]; ids?: string[] }[] = [];
vi.mock("./plugin-client", () => ({
  callPlugin: async (_u: string, _t: string, p: { action: string; fixes?: { id: string; kind: string; payload: unknown }[]; ids?: string[] }) => {
    pluginCalls.push(p);
    const done: { id: string }[] = [];
    for (const f of p.fixes ?? []) {
      stored.set(f.id, f);
      done.push({ id: f.id });
    }
    for (const id of p.ids ?? []) if (stored.delete(id)) done.push({ id });
    return { plugin_version: "1.8.1", done, applied: [...stored.values()].map((f) => ({ id: f.id, kind: f.kind, target: null })), environment: {}, removed: removedInWp };
  },
}));
vi.mock("./woo", async (orig) => ({
  ...(await orig<typeof import("./woo")>()),
  fetchSetting: async (_u: string, _g: string, id: string) => settings[id],
  wooWrite: async (_u: string, _m: string, path: string, body: { value?: unknown }) => {
    settings[path.split("/").pop()!] = body.value;
    return {};
  },
}));
const verifyCalls: string[] = [];
let verifyStatus = "resolved";
vi.mock("./verify-run", () => ({ verifyOnce: async (_a: unknown, _s: unknown, _c: unknown, t: { finding_key: string }) => (verifyCalls.push(t.finding_key), { status: verifyStatus, evidence: "checked" }) }));
vi.mock("./feed-run", () => ({ buildStoreFeed: async () => { throw new Error("not used"); } }));

const { selfHeal, autoRollback } = await import("./self-heal-run");
const store = { id: "c2ab0cfe", owner_id: "u1", url: "https://matha.site" };
const rpcs = { get_store_credentials: () => ({ consumer_key: "ck", consumer_secret: "cs" }), get_store_write_credentials: () => ({ consumer_key: "ckw", consumer_secret: "csw" }), get_traffic_connector_secret: () => ({ token: "t" }) };
const db = (rows: AuditRow[]) => fakeSupabase({ fix_audit_log: rows.map((r) => ({ ...r, store_id: store.id })), store_alerts: [], findings: [{ store_id: store.id, finding_key: "jsonld:org", type: "jsonld_org_missing", product_id: null, created_at: "1" }], stores: [{ id: store.id, alt_text_enabled: false }] }, rpcs);

beforeEach(() => {
  stored.clear();
  removedInWp.length = 0;
  pluginCalls.length = 0;
  verifyCalls.length = 0;
  verifyStatus = "resolved";
  for (const k of Object.keys(settings)) delete settings[k];
});

describe("G9 / G10 runners", () => {
  it("matha.site: the Organization fix disappears from the plugin; it is put back with the same id and payload, verified, logged and notified", async () => {
    for (const r of matha().filter((x) => x.kind !== "org")) stored.set(r.id, { id: r.id, kind: r.kind });
    const { client, tables } = db(matha());
    const r = await selfHeal(client, store, none, "job1", NOW);
    expect(r).toMatchObject({ actions: [{ audit_id: "006598d5", action: "reapplied", verify: "resolved" }] });
    expect(pluginCalls.at(-1)).toEqual({ action: "apply", fixes: [{ id: "006598d5", kind: "org", payload: { type: "OnlineStore", telephone: "+212 637 037 640" } }] });
    expect(verifyCalls).toEqual(["jsonld:org"]);
    expect(tables.fix_audit_log.at(-1)).toMatchObject({ status: "reapplied", reapplied_of: "006598d5", kind: "org", verify_status: "resolved", automatic: true, after: { fix_id: "006598d5", describe: "Put back: org fix" } });
    expect(tables.store_alerts).toMatchObject([{ kind: "fix_reapplied", title: "Put back automatically: org fix", detail: { audit_id: "006598d5", why: "the plugin no longer has this fix" } }]);

    // Removed again (by the merchant, or lost again): an alert, and it is not put back.
    stored.delete("006598d5");
    pluginCalls.length = 0;
    const again = await selfHeal(client, store, none, "job2", NOW + 3_600_000);
    expect(again).toMatchObject({ actions: [{ action: "lost" }] });
    expect(pluginCalls).toEqual([{ action: "status" }]);
    expect(tables.store_alerts.at(-1)).toMatchObject({ kind: "fix_lost", detail: { audit_id: "006598d5" } });
    await selfHeal(client, store, none, "job3", NOW + 7_200_000);
    expect(tables.store_alerts.filter((a) => a.kind === "fix_lost")).toHaveLength(1);
  });

  it("plugin 1.8.1: the Organization fix removed in WordPress admin is closed as undone there, not put back, no alert", async () => {
    for (const r of matha().filter((x) => x.kind !== "org")) stored.set(r.id, { id: r.id, kind: r.kind });
    removedInWp.push({ id: "006598d5", kind: "org", at: Date.parse("2026-10-29T08:00:00Z") / 1000 });
    const { client, tables } = db(matha());
    const r = await selfHeal(client, store, { keys: new Set(["jsonld:org"]), at: NOW }, "job1", NOW);
    expect(r).toMatchObject({ actions: [{ audit_id: "006598d5", action: "removed_in_wordpress" }] });
    expect(pluginCalls).toEqual([{ action: "status" }]);
    expect(tables.fix_audit_log.find((x) => x.id === "006598d5")).toMatchObject({ status: "reverted", reverted_by: null, reverted_at: "2026-10-29T08:00:00.000Z", revert_reason: "Removed in WordPress: org fix" });
    expect(tables.store_alerts).toEqual([]);
    // Next check: nothing more to do.
    expect(await selfHeal(client, store, { keys: new Set(["jsonld:org"]), at: NOW + 1 }, "job2", NOW + 1)).toMatchObject({ actions: [] });
  });

  it("put back but still not there (all four of matha's fixes gone): the alert says so at once", async () => {
    verifyStatus = "still_open";
    const { client, tables } = db(matha());
    await selfHeal(client, store, none, "job1", NOW);
    expect(tables.store_alerts.map((a) => a.kind)).toEqual(["fix_lost", "fix_lost", "fix_lost", "fix_lost"]);
  });

  it("G10: a new checkout problem after 'allow guest checkout' undoes it while the setting is still ours, with the reason", async () => {
    settings.woocommerce_enable_guest_checkout = "yes";
    const w = row("w1", "guest_checkout", { channel: "write_key", target: "settings:account", finding_key: "checkout:guest_disabled", before: undefined } as Partial<AuditRow>);
    const rows = [{ ...w, before: { woocommerce_enable_guest_checkout: "no" }, after: { woocommerce_enable_guest_checkout: "yes", describe: "Guest checkout turned on" } }] as unknown as AuditRow[];
    const { client, tables } = db(rows);
    const problem = { finding_key: "checkout:captcha", type: "checkout_captcha", title: "Checkout asks for a captcha", evidence: "guest checkout page shows a captcha", product_id: null };
    const r = await autoRollback(client, store, [problem], "job1", NOW);
    expect(r.rolled_back).toMatchObject([{ audit_id: "w1", result: "reverted", verify: "resolved" }]);
    expect(settings.woocommerce_enable_guest_checkout).toBe("no");
    expect(tables.fix_audit_log[0]).toMatchObject({ status: "reverted", reverted_by: null, revert_reason: expect.stringContaining("New problem after this fix (Checkout asks for a captcha)") });
    expect(tables.store_alerts[0]).toMatchObject({ kind: "fix_rolled_back", title: "Undone automatically: Guest checkout turned on" });
  });

  it("G10 never undoes the merchant's own change: a setting changed since stays", async () => {
    settings.woocommerce_enable_guest_checkout = "no"; // the merchant turned it off again
    const rows = [{ ...row("w1", "guest_checkout", { channel: "write_key", target: "settings:account" }), before: { woocommerce_enable_guest_checkout: "no" }, after: { woocommerce_enable_guest_checkout: "yes", describe: "Guest checkout turned on" } }] as unknown as AuditRow[];
    const { client, tables } = db(rows);
    const r = await autoRollback(client, store, [{ finding_key: "checkout:captcha", type: "checkout_captcha", title: "Captcha", evidence: "guest checkout captcha", product_id: null }], null, NOW);
    expect(r.rolled_back).toMatchObject([{ result: "left: woocommerce_enable_guest_checkout was changed since" }]);
    expect(tables.fix_audit_log[0].status).toBe("applied");
    expect(tables.store_alerts).toEqual([]);
  });
});
