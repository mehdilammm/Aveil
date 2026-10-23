import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fixtures/fake-supabase";

vi.mock("server-only", () => ({}));
const { deleteAccount, exportWorkspace, storesBlockingAccountDelete } = await import("./data-export");

function db() {
  const f = fakeSupabase({
    workspaces: [{ id: "w1", name: "Personal", personal: true, plan: "pro" }, { id: "w2", name: "Agency X", personal: false }],
    workspace_members: [{ workspace_id: "w1", user_id: "u1", role: "owner" }, { workspace_id: "w2", user_id: "u1", role: "admin" }, { workspace_id: "w2", user_id: "u2", role: "owner" }],
    stores: [{ id: "s1", name: "Matha", url: "https://matha.site", owner_id: "u1", workspace_id: "w1" }, { id: "s2", name: "Client shop", url: "https://c.test", owner_id: "u1", workspace_id: "w2" }],
    store_credentials: [{ store_id: "s1", consumer_key_secret_id: "secret-ref" }],
    traffic_connectors: [{ store_id: "s1", token_hint: "agsc_…abcd", token_hash: "HASH", secret_id: "secret-ref" }],
    scans: [{ id: "scan1", store_id: "s1" }],
    findings: [{ store_id: "s1", finding_key: "price_missing:173" }],
    jobs: [{ id: "j1", store_id: "s1" }],
    job_steps: [{ job_id: "j1", step_key: "start" }],
    plan_waitlist: [{ email: "Owner@Test.ma" }, { email: "other@x.test" }],
  });
  const deleted: string[] = [];
  (f.client as unknown as { auth: unknown }).auth = { admin: { deleteUser: async (id: string) => (deleted.push(id), { error: null }) } };
  return { ...f, deleted };
}

describe("data export and hard delete", () => {
  it("export holds the workspace's data, never keys, tokens or their hashes", async () => {
    const { client } = db();
    const out = (await exportWorkspace(client, "w1")) as Awaited<ReturnType<typeof exportWorkspace>> & Record<string, unknown[]>;
    expect(out.stores.map((s: { id: string }) => s.id)).toEqual(["s1"]);
    expect(out.findings).toHaveLength(1);
    expect(out.job_steps).toHaveLength(1);
    const text = JSON.stringify(out);
    expect(text).not.toContain("secret-ref");
    expect(text).not.toContain("HASH");
    expect(text).toContain("agsc_…abcd");
  });

  it("account delete is refused while the user's stores sit in someone else's workspace", async () => {
    const { client, deleted } = db();
    expect(await storesBlockingAccountDelete(client, "u1")).toEqual([{ id: "s2", name: "Client shop" }]);
    await expect(deleteAccount(client, "u1", "owner@test.ma")).rejects.toThrow("Client shop");
    expect(deleted).toEqual([]);
  });

  it("account delete: owned workspaces, waitlist sign-ups, then the user", async () => {
    const { client, tables, deleted } = db();
    tables.stores = tables.stores.filter((s) => s.id !== "s2");
    await deleteAccount(client, "u1", "owner@test.ma");
    expect(tables.workspaces.map((w) => w.id)).toEqual(["w2"]);
    expect(tables.plan_waitlist).toEqual([{ email: "other@x.test" }]);
    expect(deleted).toEqual(["u1"]);
  });
});
