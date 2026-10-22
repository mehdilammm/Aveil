import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// In-memory stand-in for the jobs tables and RPCs.
type Row = Record<string, unknown>;
let queue: Row[] = [];
let steps: Row[] = [];
let updates: { id: unknown; fields: Row }[] = [];
let secretOk = false;
const admin = {
  rpc: async (fn: string) => {
    if (fn === "jobs_tick_secret_matches") return { data: secretOk, error: null };
    if (fn === "claim_job") {
      const job = queue.shift();
      return { data: job ? [{ ...job, attempt: (job.attempt as number) + 1 }] : [], error: null };
    }
    return { data: null, error: null };
  },
  from: (table: string) => {
    const b: Record<string, unknown> = {};
    let op = "select";
    let payload: Row = {};
    const filters: Row = {};
    b.select = () => b;
    b.update = (p: Row) => ((op = "update"), (payload = p), b);
    b.upsert = (p: Row) => {
      if (table === "job_steps") steps.push(p);
      return Promise.resolve({ error: null });
    };
    b.eq = (k: string, v: unknown) => ((filters[k] = v), b);
    b.then = (resolve: (v: unknown) => void) => {
      if (op === "update") {
        updates.push({ id: filters.id, fields: payload });
        return resolve({ error: null });
      }
      return resolve({ data: table === "job_steps" ? steps.filter((s) => s.job_id === filters.job_id && s.status === "succeeded") : [], error: null });
    };
    return b;
  },
};
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));

beforeEach(() => {
  queue = [];
  steps = [];
  updates = [];
  secretOk = false;
});

describe("jobs", () => {
  it("steps already done are skipped on a retry; success marks the job", async () => {
    const { runClaimedJob } = await import("./jobs");
    steps = [{ job_id: "j1", step_key: "a", status: "succeeded" }];
    const ran: string[] = [];
    const r = await runClaimedJob(admin as never, { id: "j1", workspace_id: null, store_id: null, kind: "k", attempt: 2, max_attempts: 3, progress: {} }, {
      k: async ({ step }) => {
        await step("a", async () => ran.push("a"));
        await step("b", async () => ran.push("b"));
      },
    });
    expect(r).toBe("succeeded");
    expect(ran).toEqual(["b"]);
    expect(updates.at(-1)!.fields.status).toBe("succeeded");
  });

  it("a failure is retried with backoff, then marked failed with the reason", async () => {
    const { runClaimedJob, backoffSeconds } = await import("./jobs");
    const failing = { k: async () => { throw new Error("WooCommerce returned HTTP 503"); } };
    expect(await runClaimedJob(admin as never, { id: "j", workspace_id: null, store_id: null, kind: "k", attempt: 1, max_attempts: 3, progress: {} }, failing)).toBe("retry");
    expect(updates.at(-1)!.fields).toMatchObject({ status: "queued", error: "WooCommerce returned HTTP 503" });
    expect(backoffSeconds(1)).toBe(30);
    expect(backoffSeconds(3)).toBe(120);
    expect(await runClaimedJob(admin as never, { id: "j", workspace_id: null, store_id: null, kind: "k", attempt: 3, max_attempts: 3, progress: {} }, failing)).toBe("failed");
    expect(updates.at(-1)!.fields).toMatchObject({ status: "failed" });
  });
});

describe("POST /api/jobs/tick", () => {
  const call = async (secret?: string) => {
    const { POST } = await import("@/app/api/jobs/tick/route");
    return POST(new Request("https://app.test/api/jobs/tick", { method: "POST", headers: secret ? { "x-jobs-secret": secret } : {} }));
  };

  it("without the secret header, or with a wrong one: 404 and nothing runs", async () => {
    queue = [{ id: "j", kind: "orders_sync", attempt: 0, max_attempts: 3, progress: {} }];
    expect((await call()).status).toBe(404);
    expect((await call("short")).status).toBe(404);
    expect((await call("x".repeat(64))).status).toBe(404); // secretOk = false
    expect(queue).toHaveLength(1);
  });

  it("with the secret and nothing queued: returns at once with no work", async () => {
    secretOk = true;
    const res = await call("x".repeat(64));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ran: 0, results: [] });
  });
});
