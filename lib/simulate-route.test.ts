import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fixtures/fake-supabase";

vi.mock("server-only", () => ({}));
let role = "owner";
const db = { current: fakeSupabase() };
vi.mock("@/lib/supabase/server", () => ({ getUser: async () => ({ supabase: {}, user: { id: "u1" } }) }));
vi.mock("@/lib/workspace", async (orig) => ({ ...(await orig<typeof import("./workspace")>()), storeAccess: async () => ({ id: "s1", name: "Matha", url: "https://matha.site", owner_id: "u1", workspace_id: "w1", role }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.current.client }));
vi.mock("@/lib/job-kick", () => ({ kickJobs: () => {} }));
let browserTests = true;
vi.mock("@/lib/plan-gate", () => ({ storePlan: async () => ({ browserTests }), lockedReason: () => "Unavailable: needs Pro plan." }));

const call = async (body: object) => {
  const { POST } = await import("@/app/api/stores/[id]/simulate/route");
  const res = await POST(new Request("https://x/api", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "s1" }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const verified = [{ store_id: "s1", method: "api_key", verified_at: "2026-10-20T00:00:00Z", expires_at: "2099-01-01T00:00:00Z" }];

describe("agent purchase test route (F7)", () => {
  let hits = 0;
  beforeEach(() => {
    role = "owner";
    browserTests = true;
    hits = 0;
    db.current = fakeSupabase({ store_verifications: verified, jobs: [] }, { public_scan_hit: () => ++hits });
  });

  it("ownership-verified stores only, editors only, a known market only", async () => {
    db.current = fakeSupabase({ store_verifications: [{ ...verified[0], expires_at: "2020-01-01T00:00:00Z" }], jobs: [] });
    expect((await call({ market: "MA" })).status).toBe(403);
    db.current = fakeSupabase({ store_verifications: verified, jobs: [] });
    role = "viewer";
    expect((await call({ market: "MA" })).status).toBe(403);
    role = "owner";
    expect((await call({ market: "XX" })).status).toBe(400);
    expect(db.current.tables.jobs).toHaveLength(0);
  });

  it("queues one job with one attempt; a second click returns the open job", async () => {
    const first = await call({ market: "MA" });
    expect(first.status).toBe(202);
    db.current.tables.jobs[0].status = "queued";
    expect(db.current.tables.jobs[0]).toMatchObject({ kind: "agent_sim", store_id: "s1", workspace_id: "w1", max_attempts: 1, progress: { market: "MA" }, created_by: "u1" });
    const again = await call({ market: "US" });
    expect(again).toMatchObject({ status: 200, body: { jobId: first.body.jobId } });
    expect(db.current.tables.jobs).toHaveLength(1);
  });

  it("at most 5 tests an hour per store", async () => {
    hits = 5;
    const r = await call({ market: "MA" });
    expect(r.status).toBe(429);
    expect(String(r.body.error)).toMatch(/5 agent purchase tests an hour/);
  });

  it("browser mode: Pro only, its own job kind, at most 10 a store a UTC day", async () => {
    browserTests = false;
    const locked = await call({ mode: "browser" });
    expect(locked).toMatchObject({ status: 403, body: { error: "Unavailable: needs Pro plan." } });
    browserTests = true;
    const ok = await call({ mode: "browser" });
    expect(ok.status).toBe(202);
    expect(db.current.tables.jobs[0]).toMatchObject({ kind: "agent_sim_browser", max_attempts: 1, progress: {} });
    db.current.tables.jobs[0].status = "succeeded";
    const today = new Date().toISOString();
    for (let i = 0; i < 9; i++) db.current.tables.jobs.push({ id: `b${i}`, store_id: "s1", kind: "agent_sim_browser", status: "succeeded", created_at: today });
    const capped = await call({ mode: "browser" });
    expect(capped.status).toBe(429);
    expect(String(capped.body.error)).toMatch(/At most 10 browser tests a store a day/);
    expect(hits).toBe(0); // the hourly Store API limit is not used by browser tests
  });
});
