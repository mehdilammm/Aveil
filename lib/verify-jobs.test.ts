import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fixtures/fake-supabase";

vi.mock("server-only", () => ({}));
let answers: { status: string; evidence: string }[] = [];
vi.mock("./verify-run", () => ({ verifyOnce: vi.fn(async () => answers.shift()) }));
const { verifyFindingJob, scheduleRechecks } = await import("./verify-jobs");
const { verifyOnce } = await import("./verify-run");

function db() {
  return fakeSupabase(
    {
      stores: [{ id: "s1", owner_id: "u1", url: "https://matha.site", workspace_id: "w1" }],
      findings: [{ scan_id: "scan1", finding_key: "price_missing:173", type: "price_missing", product_id: 173 }],
      finding_verifications: [{ store_id: "s1", finding_key: "price_missing:173", status: "running" }],
      jobs: [{ id: "j1", progress: { finding_key: "price_missing:173", scan_id: "scan1" } }],
    },
    { get_store_credentials: () => ({ consumer_key: "ck", consumer_secret: "cs" }) },
    { job_steps: ["job_id", "step_key"] },
  );
}
// Runs the job while moving the fake clock past the 20 s waits between attempts.
async function run(c: Parameters<typeof verifyFindingJob>[0]) {
  const p = verifyFindingJob(c);
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(20_000);
  return p;
}
const ctx = (client: never) => ({
  admin: client,
  job: { id: "j1", workspace_id: "w1", store_id: "s1", kind: "verify_finding", attempt: 1, max_attempts: 2, progress: { finding_key: "price_missing:173", scan_id: "scan1" } },
  step: async <T,>(_k: string, run: () => Promise<T>) => run(),
  timeLeft: () => 200_000,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(verifyOnce).mockClear();
});

describe("verify loop jobs", () => {
  it("re-checks while still open (cache delay), then resolved schedules visibility runs at 7, 14, 30 days", async () => {
    const { client, tables } = db();
    answers = [{ status: "still_open", evidence: "No price" }, { status: "resolved", evidence: "gone" }];
    await run(ctx(client));
    expect(verifyOnce).toHaveBeenCalledTimes(2);
    expect(tables.finding_verifications[0]).toMatchObject({ status: "resolved", attempts: 2 });
    expect(tables.visibility_rechecks.map((r) => r.day)).toEqual([7, 14, 30]);
    expect(tables.jobs.filter((j) => j.kind === "visibility")).toHaveLength(3);
  });

  it("still open after 3 tries stays open with the evidence; no re-checks are scheduled", async () => {
    const { client, tables } = db();
    answers = [1, 2, 3].map(() => ({ status: "still_open", evidence: "No price" }));
    await run(ctx(client));
    expect(tables.finding_verifications[0]).toMatchObject({ status: "still_open", attempts: 3, evidence: "No price" });
    expect(tables.visibility_rechecks ?? []).toEqual([]);
  });

  it("an unavailable re-check is never 'resolved'", async () => {
    const { client, tables } = db();
    answers = [{ status: "unavailable", evidence: "HTTP 503" }];
    await run(ctx(client));
    expect(verifyOnce).toHaveBeenCalledTimes(1);
    expect(tables.finding_verifications[0]).toMatchObject({ status: "unavailable", evidence: "HTTP 503" });
  });

  it("two fixes verified the same day share the same three runs", async () => {
    const { client, tables } = db();
    const store = { id: "s1", owner_id: "u1", workspace_id: "w1" };
    const now = new Date("2026-10-23T10:00:00Z");
    await scheduleRechecks(client, store, "a", now);
    await scheduleRechecks(client, store, "b", now);
    expect(tables.visibility_rechecks.map((r) => [r.due_on, r.finding_keys])).toEqual([["2026-10-30", ["a", "b"]], ["2026-11-06", ["a", "b"]], ["2026-11-22", ["a", "b"]]]);
    expect(tables.jobs.filter((j) => j.kind === "visibility").map((j) => j.run_after)).toEqual(["2026-10-30T06:00:00.000Z", "2026-11-06T06:00:00.000Z", "2026-11-22T06:00:00.000Z"]);
  });
});
