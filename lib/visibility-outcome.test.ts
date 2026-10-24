import { describe, expect, it } from "vitest";
import { fixedAt, visibilityOutcomes, type OutcomeRecheck, type OutcomeResult } from "./visibility-outcome";

const runs = [
  { id: "r0", status: "complete", created_at: "2026-10-20T10:00:00.000Z" },
  { id: "r1", status: "complete", created_at: "2026-10-22T10:00:00.000Z" },
  { id: "rf", status: "failed", created_at: "2026-10-23T09:00:00.000Z" },
  { id: "r7", status: "complete", created_at: "2026-10-30T06:05:00.000Z" },
];
const res = (run_id: string, prompt: string, engine: string, mentioned: boolean | null, error: string | null = null): OutcomeResult => ({ run_id, prompt_id: `p-${prompt}`, prompt, engine, mentioned, error });
const results = [
  res("r1", "best LED mirror", "gemini", false),
  res("r1", "LED mirror Morocco", "gemini", true),
  res("r1", "gift mirror", "gemini", false),
  res("r1", "only before", "gemini", false),
  res("r7", "best LED mirror", "gemini", true),
  res("r7", "LED mirror Morocco", "gemini", false),
  res("r7", "gift mirror", "gemini", null, "Skipped: time limit"),
  res("r7", "best LED mirror", "mistral", true),
  res("r7", "only after", "gemini", true),
];
const checked = new Map([["image_missing:171", "2026-10-23T12:00:00.000Z"]]);
const rc = (day: number, due_on: string, job: OutcomeRecheck["job"]): OutcomeRecheck => ({ day, due_on, finding_keys: ["image_missing:171"], job });

describe("visibility outcome track", () => {
  it("fix time is the verification time, else the start of the fix day", () => {
    expect(fixedAt(rc(7, "2026-10-30", null), checked)).toBe("2026-10-23T12:00:00.000Z");
    expect(fixedAt(rc(7, "2026-10-30", null), new Map())).toBe("2026-10-23T00:00:00.000Z");
  });

  it("compares only questions answered both times, same engine; baseline is the last complete run before the fix", () => {
    const [o] = visibilityOutcomes([rc(7, "2026-10-30", { status: "succeeded", error: null, run_id: "r7" })], runs, results, checked);
    expect(o.state).toBe("done");
    expect(o.basis).toBe("observed");
    expect(o.before).toMatchObject({ runId: "r1", named: 1, answered: 2 });
    expect(o.after).toMatchObject({ runId: "r7", named: 1, answered: 2 });
    expect(o.gained).toEqual(["best LED mirror"]);
    expect(o.lost).toEqual(["LED mirror Morocco"]);
  });

  it("pending, failed, no baseline and no overlap are Unavailable with the reason", () => {
    const out = visibilityOutcomes(
      [
        rc(14, "2026-11-06", { status: "queued", error: null, run_id: null }),
        rc(30, "2026-11-22", { status: "failed", error: "Daily cost cap reached", run_id: null }),
        rc(7, "2026-10-21", { status: "succeeded", error: null, run_id: "r1" }),
      ],
      runs,
      results,
      new Map(),
    );
    expect(out.map((o) => [o.day, o.state, o.basis, o.reason])).toEqual([
      [7, "no_baseline", "unavailable", "no AI Visibility run before the fix to compare with"],
      [14, "pending", "unavailable", "due on 2026-11-06"],
      [30, "failed", "unavailable", "Daily cost cap reached"],
    ]);
    const [none] = visibilityOutcomes([rc(7, "2026-10-30", { status: "succeeded", error: null, run_id: "r7" })], runs, results.filter((r) => r.prompt === "only before" || r.prompt === "only after"), checked);
    expect(none.state).toBe("no_overlap");
  });
});
