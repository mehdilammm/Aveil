import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fixtures/fake-supabase";
import { sign } from "./traffic";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/job-kick", () => ({ kickJobs: () => {} }));
let plan = "pro";
vi.mock("@/lib/orders-sync", () => ({ planOf: async () => plan }));
const db = { current: fakeSupabase() };
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.current.client }));

const STORE = "c2ab0cfe-d60a-4d93-ae3e-983598108948";
const ev = (n: number, kind: string, extra: Record<string, unknown> = {}) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, kind, subject: "Woo Cache", slug: null, old_version: "2.1.0", new_version: "2.2.0", product_id: null, at: new Date().toISOString(), ...extra });

async function send(events: unknown[], ts = String(Math.floor(Date.now() / 1000))) {
  const { POST } = await import("@/app/api/ingest/events/route");
  const body = JSON.stringify({ events });
  const res = await POST(new Request("https://x/api/ingest/events", { method: "POST", body, headers: { "x-agentscope-store": STORE, "x-agentscope-timestamp": ts, "x-agentscope-signature": sign("agsc_tok", ts, body) } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("/api/ingest/events (plugin 1.7.0)", () => {
  beforeEach(() => {
    plan = "pro";
    const seen = new Map<string, number>();
    db.current = fakeSupabase(
      { stores: [{ id: STORE, workspace_id: "w1" }], store_events: [], jobs: [] },
      {
        traffic_rate_check: () => true,
        get_traffic_connector_secret: () => ({ owner_id: "u1", token: "agsc_tok" }),
        public_scan_hit: (a) => (seen.set(String(a.p_ip_hash), (seen.get(String(a.p_ip_hash)) ?? 0) + 1), seen.get(String(a.p_ip_hash))),
      },
      { store_events: ["store_id", "event_id"] },
    );
  });

  it("refuses a bad signature", async () => {
    const { POST } = await import("@/app/api/ingest/events/route");
    const res = await POST(new Request("https://x", { method: "POST", body: "{}", headers: { "x-agentscope-store": STORE, "x-agentscope-timestamp": String(Math.floor(Date.now() / 1000)), "x-agentscope-signature": "sha256=00" } }));
    expect(res.status).toBe(401);
  });

  it("a plugin update queues one delayed breakage check (Pro); a product update queues a product check", async () => {
    const r = await send([ev(1, "plugin_updated"), ev(2, "theme_switched"), ev(3, "product_updated", { product_id: 173 })]);
    expect(r).toMatchObject({ status: 200, body: { accepted: 3, checks: 2 } });
    const jobs = db.current.tables.jobs;
    expect(jobs.map((j) => j.kind).sort()).toEqual(["breakage_check", "product_check"]);
    const b = jobs.find((j) => j.kind === "breakage_check")!;
    expect((b.progress as { event_ids: string[] }).event_ids).toHaveLength(2);
    expect(Date.parse(String(b.run_after))).toBeGreaterThan(Date.now() + 60_000);
    expect(db.current.tables.store_events.every((e) => e.job_id)).toBe(true);
  });

  it("the same events again are stored once and start nothing; a second change joins the waiting check", async () => {
    await send([ev(1, "plugin_updated")]);
    const again = await send([ev(1, "plugin_updated")], String(Math.floor(Date.now() / 1000) - 1));
    expect(again.body).toMatchObject({ accepted: 0, checks: 0 });
    await send([ev(4, "plugin_activated")], String(Math.floor(Date.now() / 1000) - 2));
    const checks = db.current.tables.jobs.filter((j) => j.kind === "breakage_check");
    expect(checks).toHaveLength(1);
    expect((checks[0].progress as { event_ids: string[] }).event_ids).toHaveLength(2);
  });

  it("Free: no breakage check (Pro only), but the product check runs; one per product every 5 minutes", async () => {
    plan = "free";
    await send([ev(1, "plugin_updated"), ev(2, "product_published", { product_id: 173 })]);
    await send([ev(3, "product_updated", { product_id: 173 })], String(Math.floor(Date.now() / 1000) - 1));
    expect(db.current.tables.jobs.map((j) => j.kind)).toEqual(["product_check"]);
    expect(db.current.tables.store_events).toHaveLength(3);
  });

  it("the same signed request twice is a replay and changes nothing", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const same = [ev(1, "plugin_updated")];
    await send(same, ts);
    const r = await send(same, ts);
    expect(r.body).toEqual({ ok: true, duplicate: true });
  });
});
