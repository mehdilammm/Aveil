import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fixtures/fake-supabase";
vi.mock("server-only", () => ({}));
import { visibilityPrecheck } from "./visibility-run";

const store = { id: "s1", owner_id: "u1", name: "Matha", url: "https://matha.site" };

describe("re-check runs and the weekly wait", () => {
  const prev = process.env.GEMINI_API_KEY;
  beforeEach(() => void (process.env.GEMINI_API_KEY = "test-key"));
  afterEach(() => void (process.env.GEMINI_API_KEY = prev));

  const runAgo = (days: number, plan: string) =>
    fakeSupabase({ stores: [{ id: "s1", workspaces: { plan } }], visibility_runs: [{ id: "r1", store_id: "s1", status: "complete", created_at: new Date(Date.now() - days * 86_400_000).toISOString() }] }).client;

  it("a run 2 days ago blocks a normal run but not a 7/14/30-day re-check", async () => {
    const admin = runAgo(2, "pro");
    expect((await visibilityPrecheck(admin, store))?.error).toMatch(/once a week on the Pro plan/);
    expect(await visibilityPrecheck(admin, store, { recheck: true })).toBeNull();
  });

  it("Free runs once a month (3 questions); Pro once a week; test re-runs are not on Free", async () => {
    expect((await visibilityPrecheck(runAgo(10, "free"), store))?.error).toMatch(/once a month on the Free plan/);
    expect(await visibilityPrecheck(runAgo(31, "free"), store)).toBeNull();
    expect(await visibilityPrecheck(runAgo(10, "pro"), store)).toBeNull();
    expect((await visibilityPrecheck(runAgo(31, "free"), store, { test: true }))?.error).toBe("Unavailable: needs Pro plan.");
  });
});
