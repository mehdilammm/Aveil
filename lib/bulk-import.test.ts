import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const writes: { path: string; body: unknown }[] = [];
let store: { id: number; name: string; sku: string; global_unique_id: string; weight: string }[] = [];
vi.mock("./woo", async (orig) => ({
  ...(await orig<typeof import("./woo")>()),
  fetchProductsFor: async (_u: string, _c: unknown, by: { ids?: number[]; skus?: string[] }) => store.filter((p) => by.ids?.includes(p.id) || by.skus?.map((s) => s.toLowerCase()).includes(p.sku.toLowerCase())),
  wooWrite: async (_u: string, _m: string, path: string, body: unknown) => {
    if (JSON.stringify(body).includes("REFUSED")) throw new Error("Invalid or duplicated SKU.");
    writes.push({ path, body });
  },
}));
import { applyImport, importPreview } from "./bulk-fixes";
import { importPatch, parseCsv, previewImport, readImport } from "./bulk-import";
import { fakeSupabase } from "./fixtures/fake-supabase";

const reset = () => {
  writes.length = 0;
  store = [
    { id: 173, name: "Custom Laser Engraved Mirror", sku: "", global_unique_id: "", weight: "" },
    { id: 171, name: "LED Mirror", sku: "LED-1", global_unique_id: "4006381333931", weight: "2" },
  ];
};
const ctx = (write = true) => ({ store: { id: "s1", owner_id: "u1", url: "https://matha.site" }, read: { consumerKey: "ck", consumerSecret: "cs" }, write: write ? { consumerKey: "ckw", consumerSecret: "csw" } : null, pluginToken: null }) as never;

describe("CSV parsing and checks", () => {
  it("reads commas or semicolons, quotes, BOM and CRLF", () => {
    expect(parseCsv('﻿product_id;gtin\r\n173;"40063 81333931"\r\n\r\n')).toEqual([["product_id", "gtin"], ["173", "40063 81333931"]]);
    expect(parseCsv('id,sku\n1,"A ""B"", C"')).toEqual([["id", "sku"], ["1", 'A "B", C']]);
  });

  it("checks every cell like a single fix and refuses duplicates", () => {
    const p = readImport("product_id,EAN,sku,weight\n173,4006381333932,MIR-173,1.2\n171,,MIR-173,\n171,,,\nabc,,,1\n172,,,0");
    if (!p.ok) throw new Error(p.reason);
    expect(p.fields).toEqual(["gtin", "sku", "weight"]);
    expect(p.lines[0].errors[0]).toMatch(/check digit/);
    expect(p.lines[1].errors.join(" ")).toMatch(/also on line 2/);
    expect(p.lines[2].errors.join(" ")).toMatch(/same product is already on line 3/);
    expect(p.lines[3].errors.join(" ")).toMatch(/whole number/);
    expect(p.lines[4].errors.join(" ")).toMatch(/Weight/);
  });

  it("refuses files without a usable column, too many lines, or no match column", () => {
    expect(readImport("product_id,colour\n1,red")).toEqual({ ok: false, reason: "No column to import: use gtin, sku or weight." });
    expect(readImport("gtin\n4006381333931")).toMatchObject({ ok: false });
    expect(readImport(`product_id,weight\n${Array.from({ length: 201 }, (_, i) => `${i + 1},1`).join("\n")}`)).toMatchObject({ ok: false, reason: "At most 200 product lines per file." });
  });

  it("matched by SKU, the sku column finds the product and is not written", () => {
    reset();
    const p = readImport("sku,weight\nled-1,2.5\nNOPE,1");
    if (!p.ok) throw new Error("parse");
    const pv = previewImport(p, store);
    expect(pv.rows.map((r) => [r.status, r.productId, r.changes])).toEqual([["ok", 171, [{ field: "weight", before: "2", after: "2.5" }]], ["error", null, []]]);
    expect(pv.rows[1].reason).toBe('No published product with SKU "NOPE".');
  });
});

describe("preview, apply and undo data", () => {
  const csv = "product_id,gtin,sku,weight\n173,4006381333931,MIR-173,1.2\n171,4006381333931,LED-1,2\n999,,,1";

  it("previews exact changes; unchanged and unknown lines are not written", async () => {
    reset();
    const p = await importPreview(ctx(), csv);
    if (!p.ok) throw new Error(p.reason);
    expect(p.ready).toBe(1);
    expect(p.rows.map((r) => r.status)).toEqual(["ok", "same", "error"]);
    expect(importPatch(p.rows[0])).toEqual({ patch: { global_unique_id: "4006381333931", sku: "MIR-173", weight: "1.2" }, before: { global_unique_id: "", sku: "", weight: "" } });
  });

  it("applies only the approved preview, logs before/after in one batch; a changed store needs a new preview", async () => {
    reset();
    const p = await importPreview(ctx(), csv);
    if (!p.ok) throw new Error(p.reason);
    const { client, tables } = fakeSupabase({ fix_audit_log: [] });
    store[0].weight = "9";
    expect(await applyImport(client, ctx(), csv, p.hash, "u1")).toMatchObject({ ok: false, status: 409 });
    expect(writes).toEqual([]);
    reset();
    const r = await applyImport(client, ctx(), csv, p.hash, "u1");
    expect(r).toMatchObject({ ok: true, results: [{ line: 2, productId: 173, status: "applied", error: null }] });
    expect(writes).toEqual([{ path: "/products/173", body: { global_unique_id: "4006381333931", sku: "MIR-173", weight: "1.2" } }]);
    expect(tables.fix_audit_log).toHaveLength(1);
    expect(tables.fix_audit_log[0]).toMatchObject({ fix_type: "input", kind: "csv_import", channel: "write_key", target: "product:173", status: "applied", before: { global_unique_id: "", sku: "", weight: "" } });
    expect(await applyImport(client, ctx(false), csv, p.hash, "u1")).toMatchObject({ ok: false, status: 400 });
  });

  it("a refused write is logged as failed with WooCommerce's reason and nothing to undo", async () => {
    reset();
    const bad = "product_id,sku\n173,REFUSED";
    const p = await importPreview(ctx(), bad);
    if (!p.ok) throw new Error(p.reason);
    const { client, tables } = fakeSupabase({ fix_audit_log: [] });
    const r = await applyImport(client, ctx(), bad, p.hash, "u1");
    expect(r).toMatchObject({ ok: true, results: [{ status: "failed", error: "Invalid or duplicated SKU." }] });
    expect(tables.fix_audit_log[0]).toMatchObject({ status: "failed", before: null });
  });
});

describe("bulk apply list", () => {
  it("auto and one-click fixes not applied yet; one-click needs the write key; input and guide fixes are not in it", async () => {
    const { planBulk } = await import("./bulk-fixes");
    const f = (finding_key: string, type: string, product_id: number | null = null) => ({ finding_key, type, evidence: "", product_id, title: type });
    const findings = [f("checkout:guest", "checkout_guest_disabled"), f("llms_txt:missing", "llms_txt_missing"), f("price_missing:1", "price_missing", 1), f("feed_brand_missing:2", "feed_brand_missing", 2), f("access:GPTBot", "access_rate_limited")];
    const withKey = planBulk(ctx(), findings, new Set(["llms_txt:missing"]));
    expect(withKey.map((p) => [p.finding.finding_key, p.type, p.ready])).toEqual([["checkout:guest", "one_click", true], ["feed_brand_missing:2", "auto", true]]);
    expect(planBulk(ctx(false), findings, new Set()).find((p) => p.finding.finding_key === "checkout:guest")).toMatchObject({ ready: false, reason: "Add a write key first (Fix Center → Write access)." });
  });
});
