import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fixtures/fake-supabase";

vi.mock("server-only", () => ({}));
let role = "owner";
let verified = false;
const db = { current: fakeSupabase() };
vi.mock("@/lib/supabase/server", () => ({ getUser: async () => ({ supabase: {}, user: { id: "u1" } }) }));
vi.mock("@/lib/workspace", () => ({ storeAccess: async () => ({ id: "s1", name: "Matha", url: "https://matha.site", owner_id: "u1", workspace_id: "w1", role }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.current.client }));
vi.mock("@/lib/ownership", async (orig) => ({ ...(await orig<typeof import("./ownership")>()), checkManual: async () => (verified ? { verified: true, evidence: "file found" } : { verified: false, evidence: "file missing" }) }));
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-secret";

const call = async (body: object) => {
  const { POST } = await import("@/app/api/stores/[id]/url/route");
  const res = await POST(new Request("https://x/api", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "s1" }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe("store address change", () => {
  beforeEach(() => {
    role = "owner";
    verified = false;
    db.current = fakeSupabase(
      {
        stores: [{ id: "s1", url: "https://matha.site", auto_fix_enabled: true, connection_status: "connected" }],
        store_verifications: [{ store_id: "s1", method: "api_key", verified_at: "2026-10-20T00:00:00Z", expires_at: "2027-01-01T00:00:00Z" }],
      },
      {},
      { store_verifications: ["store_id", "method"] },
    );
  });

  it("owner only", async () => {
    role = "admin";
    expect((await call({ url: "https://new.example", action: "start" })).status).toBe(403);
  });

  it("nothing changes until the new address passes the check", async () => {
    const start = await call({ url: "https://new.example", action: "start" });
    expect(start.status).toBe(200);
    expect(String((start.body.methods as { dns_txt: { value: string } }).dns_txt.value)).toMatch(/^agentscope-verification=[0-9a-f]{32}$/);
    const failed = await call({ url: "https://new.example", action: "confirm", method: "well_known_file" });
    expect(failed).toMatchObject({ status: 422, body: { verified: false, evidence: "file missing" } });
    expect(db.current.tables.stores[0]).toMatchObject({ url: "https://matha.site", auto_fix_enabled: true });
    expect(db.current.tables.store_verifications).toHaveLength(1);
  });

  it("after the check: new address, old verifications gone, new one recorded, auto-fix off", async () => {
    verified = true;
    const ok = await call({ url: "https://new.example", action: "confirm", method: "well_known_file" });
    expect(ok).toMatchObject({ status: 200, body: { verified: true, url: "https://new.example" } });
    expect(db.current.tables.stores[0]).toMatchObject({ url: "https://new.example", auto_fix_enabled: false, connection_status: "not-connected" });
    expect(db.current.tables.store_verifications.map((v) => v.method)).toEqual(["well_known_file"]);
  });
});
