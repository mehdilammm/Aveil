import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShippingZone } from "./checkout";
import { fakeSupabase } from "./fixtures/fake-supabase";

vi.mock("server-only", () => ({}));
let pluginVersion = "1.8.0";
const calls: { action: string; fixes?: { id: string; kind: string; payload: Record<string, unknown> }[] }[] = [];
vi.mock("./plugin-client", () => ({
  callPlugin: async (_u: string, _t: string, payload: (typeof calls)[number]) => {
    calls.push(payload);
    return { plugin_version: pluginVersion, done: pluginVersion >= "1.8.0" ? (payload.fixes ?? []).map((f) => ({ id: f.id })) : [], applied: [], environment: { robots_file: false, llms_file: false, woocommerce: true } };
  },
}));
vi.mock("./verify-run", () => ({ verifyOnce: async () => ({ status: "resolved", evidence: "printed" }) }));
// matha.site, 2026-10-28 (read only): home page contact line, shipping zones and methods, search results.
const HOME = '<p>Custom size or design? Message us on WhatsApp: <a href="https://wa.me/212637037640">+212 637 037 640</a></p>';
const ZONES: ShippingZone[] = [
  { id: 0, name: "Locations not covered by your other zones", locations: [], methods: [] },
  { id: 1, name: "Marrakech", locations: [{ code: "MA:mamar", type: "state" }], methods: [{ method_id: "free_shipping", enabled: true, title: "Free delivery in Marrakech", settings: { requires: "", min_amount: "0" } }] },
  { id: 2, name: "Morocco", locations: [{ code: "MA", type: "country" }], methods: [{ method_id: "flat_rate", enabled: true, title: "Delivery across Morocco", settings: { tax_status: "taxable", cost: "35" } }] },
];
vi.mock("./woo", async (orig) => ({
  ...(await orig<typeof import("./woo")>()),
  fetchPublicPage: async (u: string) => (u.includes("?s=") ? { ok: true, status: 200, body: '<a href="https://matha.site/product/round-led-mirror/">Round LED Mirror</a>', finalUrl: u, redirectedTo: null, bytes: 1, challengeHeader: false } : { ok: true, status: 200, body: HOME, finalUrl: u, redirectedTo: null, bytes: 1, challengeHeader: false }),
  fetchShippingZones: async () => ({ ok: true, data: ZONES }),
  fetchCountryStateNames: async () => ({ mamar: "Marrakech" }),
}));
vi.mock("./platform/woocommerce", () => ({
  wooCommerceAdapter: () => ({
    fetchPolicies: async () => ({ settings: { ok: true, data: { woocommerce_currency: "MAD", woocommerce_calc_taxes: "no" } }, pages: { ok: true, data: [] }, siteName: { ok: true, data: "Matha Mirrors" } }),
    fetchProductsPage: async () => ({ items: [{ id: 174, name: "Round LED Mirror", type: "simple", price: "800", permalink: "https://matha.site/product/round-led-mirror/", stock_status: "instock", virtual: false }], total: 1, totalPages: 1 }),
  }),
}));

const { applyFixes, planAuto } = await import("./autofix");
const store = { id: "s1", owner_id: "u1", url: "https://matha.site" };
const ctx = { store, read: { consumerKey: "ck", consumerSecret: "cs" }, write: null, pluginToken: "agsc_t" };
const f = (type: string) => ({ finding_key: `jsonld:${type}`, type, evidence: "", product_id: null });
const apply = async (type: string, kind: "org" | "website" | "shipping") => {
  const { client, tables } = fakeSupabase();
  const r = await applyFixes(client, ctx, [{ finding: f(type), type: "auto", kind }], { userId: null, automatic: true });
  return { r: r.results[0], row: tables.fix_audit_log[0], sent: calls.at(-1)?.fixes?.[0] };
};

beforeEach(() => {
  calls.length = 0;
  pluginVersion = "1.8.0";
});

describe("structured data auto fixes (G2, G3, G5)", () => {
  it("planned as auto fixes; an SEO plugin that prints its own makes them guidance", async () => {
    const { fixFor } = await import("./fix-catalog");
    expect(planAuto(ctx, [f("jsonld_org_missing"), f("jsonld_website_missing"), f("jsonld_breadcrumb_missing"), f("jsonld_shipping_missing"), f("jsonld_variants_missing")]).map((p) => [p.kind, p.ready])).toEqual([["org", true], ["website", true], ["breadcrumbs", true], ["shipping", true], ["variants", true]]);
    expect(fixFor({ ...f("jsonld_org_missing"), evidence: "https://s/: no JSON-LD at all. (seo plugin: Yoast SEO)" }).type).toBe("guide");
    expect(fixFor({ ...f("jsonld_shipping_missing"), evidence: "x (seo plugin: Yoast SEO)" }).type).toBe("auto");
    expect(fixFor(f("jsonld_returns_missing"))).toEqual({ type: "one_click", kind: "returns" });
  });

  it("G2 on matha.site: the plugin gets the published phone only, with where it was found", async () => {
    const { r, row, sent } = await apply("jsonld_org_missing", "org");
    expect(r).toMatchObject({ status: "applied", describe: "Organization added with the published phone", verify: "resolved" });
    expect(sent).toMatchObject({ kind: "org", payload: { type: "OnlineStore", telephone: "+212 637 037 640" } });
    expect(row).toMatchObject({ channel: "plugin", target: "jsonld:org", after: { notes: ['telephone: WhatsApp link "+212 637 037 640" on https://matha.site/'] } });
  });

  it("G5 on matha.site: the search answers with the product, so the search box is included", async () => {
    const { sent } = await apply("jsonld_website_missing", "website");
    expect(sent).toMatchObject({ kind: "website", payload: { search: "https://matha.site/?s={search_term_string}&post_type=product" } });
  });

  it("G3 on matha.site: the Marrakech zone is written; the Morocco flat rate is listed as not written", async () => {
    const { r, row, sent } = await apply("jsonld_shipping_missing", "shipping");
    expect(sent?.payload).toEqual({ currency: "MAD", zones: [{ country: "MA", region: "Marrakech", rates: [{ type: "free" }] }] });
    expect(r.describe).toBe("Shipping details added for 1 destination(s); 1 not written");
    expect((row.after as { notes: string[] }).notes).toEqual(['zone "Morocco" (MA): not written, because an earlier zone takes part of MA and schema.org cannot say "the rest of MA"']);
  });

  it("plugin 1.7.0 refuses: the fix is logged as failed with the reason", async () => {
    pluginVersion = "1.7.0";
    const { r, row } = await apply("jsonld_org_missing", "org");
    expect(r).toMatchObject({ status: "failed", error: "The plugin did not take this fix (plugin 1.7.0; it needs 1.8.0 or later)." });
    expect(row).toMatchObject({ status: "failed", channel: "plugin" });
  });
});
