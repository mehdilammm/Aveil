import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fixtures/fake-supabase";

vi.mock("server-only", () => ({}));
const calls: { fixes?: { kind: string; payload: Record<string, unknown> }[] }[] = [];
vi.mock("./plugin-client", () => ({
  callPlugin: async (_u: string, _t: string, payload: { fixes?: { id: string; kind: string; payload: Record<string, unknown> }[] }) => (calls.push(payload), { plugin_version: "1.8.0", done: (payload.fixes ?? []).map((f) => ({ id: f.id })), applied: [], environment: {} }),
}));
vi.mock("./verify-run", () => ({ verifyOnce: async () => ({ status: "resolved", evidence: "printed" }) }));
// matha.site's Returns Policy page body (2026-10-28) and its selling countries.
let body = '<main><h2>No returns</h2><p>All mirrors are final sale. Mirrors cannot be returned or refunded.</p></main>';
vi.mock("./woo", async (orig) => ({ ...(await orig<typeof import("./woo")>()), fetchPublicPage: async (u: string) => ({ ok: true, status: 200, body, finalUrl: u, redirectedTo: null, bytes: 1, challengeHeader: false }) }));
vi.mock("./platform/woocommerce", () => ({
  wooCommerceAdapter: () => ({ fetchPolicies: async () => ({ settings: { ok: true, data: { woocommerce_allowed_countries: "specific", woocommerce_specific_allowed_countries: "MA" } }, pages: { ok: true, data: [{ id: 129, slug: "refund_returns", title: "Returns Policy" }] }, siteName: { ok: true, data: "Matha Mirrors" } }) }),
}));
const { applyFixes } = await import("./autofix");
const { returnsProposalFor } = await import("./schema-fixes");
const ctx = { store: { id: "s1", owner_id: "u1", url: "https://matha.site" }, read: { consumerKey: "ck", consumerSecret: "cs" }, write: null, pluginToken: "agsc_t" };
const finding = { finding_key: "jsonld:returns", type: "jsonld_returns_missing", evidence: "", product_id: null };

beforeEach(() => {
  calls.length = 0;
  body = '<main><h2>No returns</h2><p>All mirrors are final sale. Mirrors cannot be returned or refunded.</p></main>';
});

describe("return policy fix (G7)", () => {
  it("matha.site: the proposal shown is the one applied, with its sentences in the audit log", async () => {
    const p = await returnsProposalFor(ctx);
    expect(p).toMatchObject({ proposal: { category: "MerchantReturnNotPermitted", countries: ["MA"], link: "https://matha.site/refund_returns/" }, basis: ["No returns", "All mirrors are final sale.", "Mirrors cannot be returned or refunded."] });
    const { client, tables } = fakeSupabase();
    const r = await applyFixes(client, ctx, [{ finding, type: "one_click", kind: "returns", value: JSON.stringify({ hash: p.hash }) }], { userId: "u1", automatic: false });
    expect(r.results[0]).toMatchObject({ status: "applied", describe: "Return policy added to all products: no returns (MA)" });
    expect(calls[0].fixes![0]).toMatchObject({ kind: "returns", payload: p.proposal });
    expect(tables.fix_audit_log[0]).toMatchObject({ fix_type: "one_click", target: "jsonld:returns", after: { basis: p.basis, page: "https://matha.site/refund_returns/", source: "page" } });
  });

  it("a page that changed after the preview is not applied; the merchant's answer is", async () => {
    const p = await returnsProposalFor(ctx);
    body = "<main><p>You can return items within 30 days.</p></main>";
    const { client } = fakeSupabase();
    const stale = await applyFixes(client, ctx, [{ finding, type: "one_click", kind: "returns", value: JSON.stringify({ hash: p.hash }) }], { userId: "u1", automatic: false });
    expect(stale.results[0]).toMatchObject({ status: "failed", error: "The returns page or the selling countries changed since you saw the proposal; open it again." });
    expect(calls).toEqual([]);
    const answer = await applyFixes(client, ctx, [{ finding, type: "input", kind: "returns", value: JSON.stringify({ answer: JSON.stringify({ category: "MerchantReturnFiniteReturnWindow", days: 14, countries: ["MA"] }) }) }], { userId: "u1", automatic: false });
    expect(answer.results[0]).toMatchObject({ status: "applied", describe: "Return policy added to all products: returns within 14 days (MA)" });
  });
});
