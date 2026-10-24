import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fixtures/fake-supabase";
vi.mock("server-only", () => ({}));
import { visibilityPrecheck } from "./visibility-run";

const store = { id: "s1", owner_id: "u1", name: "Matha", url: "https://matha.site" };

describe("re-check runs and the weekly wait", () => {
  const prev = process.env.GEMINI_API_KEY;
  beforeEach(() => void (process.env.GEMINI_API_KEY = "test-key"));
  afterEach(() => void (process.env.GEMINI_API_KEY = prev));

  it("a run 2 days ago blocks a normal run but not a 7/14/30-day re-check", async () => {
    const { client: admin } = fakeSupabase({ visibility_runs: [{ id: "r1", store_id: "s1", status: "complete", created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() }] });
    expect((await visibilityPrecheck(admin, store))?.error).toMatch(/once a week/);
    expect(await visibilityPrecheck(admin, store, { recheck: true })).toBeNull();
  });
});
