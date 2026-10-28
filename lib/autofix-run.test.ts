import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fixtures/fake-supabase";

vi.mock("server-only", () => ({}));
const applied: string[][] = [];
vi.mock("./autofix", () => ({
  fixContext: async () => ({ pluginToken: "t" }),
  planAuto: (_c: unknown, fs: { finding_key: string }[]) => fs.map((f) => ({ finding: f, type: "auto", kind: "feed", ready: true })),
  applyFixes: async (_a: unknown, _c: unknown, items: { finding: { finding_key: string } }[]) => (applied.push(items.map((i) => i.finding.finding_key)), { batchId: "b", results: items.map(() => ({ status: "applied" })) }),
}));
const { runAutoFix } = await import("./autofix-run");

describe("automatic fixes after a scan", () => {
  it("skips applied, undone and recently failed fixes; a failure older than 7 days is tried again", async () => {
    const day = 86_400_000;
    const { client } = fakeSupabase({
      findings: ["feed:not_served", "llms_txt:missing", "robots:OAI-SearchBot", "brand:174", "brand:175"].map((k) => ({ scan_id: "sc", finding_key: k, type: "x", evidence: "", product_id: null })),
      fix_audit_log: [
        { store_id: "s1", finding_key: "feed:not_served", status: "failed", applied_at: new Date(Date.now() - 2 * day).toISOString() },
        { store_id: "s1", finding_key: "llms_txt:missing", status: "failed", applied_at: new Date(Date.now() - 10 * day).toISOString() },
        { store_id: "s1", finding_key: "robots:OAI-SearchBot", status: "applied", applied_at: new Date().toISOString() },
        { store_id: "s1", finding_key: "brand:174", status: "reverted", applied_at: new Date().toISOString() },
      ],
    });
    expect(await runAutoFix(client, { id: "s1", owner_id: "u1", url: "https://matha.site" }, "sc")).toMatchObject({ applied: 2 });
    expect(applied[0]).toEqual(["llms_txt:missing", "brand:175"]);
  });
});
