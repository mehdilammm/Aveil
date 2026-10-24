// Visibility outcome track (G5): for each fix-verified re-check (7, 14 or 30 days after the fix), compare what the
// models returned before the fix with what they returned on the re-check, question by question and engine by
// engine. Only questions answered both times are compared. This shows what changed in model answers; it is not
// proof that the fix caused it (answers vary between runs, and ungrounded models do not read the store live).
import type { Basis } from "./rules";

export type OutcomeRecheck = { due_on: string; day: number; finding_keys: string[]; job: { status: string; error: string | null; run_id: string | null } | null };
export type OutcomeRun = { id: string; status: string; created_at: string };
export type OutcomeResult = { run_id: string; prompt_id: string | null; prompt: string; engine: string; mentioned: boolean | null; error: string | null };

export type Outcome = {
  day: number;
  due_on: string;
  fixedAt: string;
  fixes: number;
  state: "pending" | "failed" | "no_baseline" | "no_overlap" | "done";
  basis: Basis;
  reason: string | null;
  before: { runId: string; at: string; named: number; answered: number } | null;
  after: { runId: string; at: string; named: number; answered: number } | null;
  gained: string[];
  lost: string[];
};

const keyOf = (r: OutcomeResult) => `${r.engine}|${r.prompt_id ?? r.prompt}`;
const usable = (r: OutcomeResult) => !r.error && r.mentioned !== null;

// When the fix was verified: the earliest verification of its findings, else the start of the fix day.
export function fixedAt(r: OutcomeRecheck, checkedAt: Map<string, string>): string {
  const day0 = new Date(Date.parse(`${r.due_on}T00:00:00Z`) - r.day * 86_400_000).toISOString();
  const seen = r.finding_keys.map((k) => checkedAt.get(k)).filter((x): x is string => Boolean(x) && Date.parse(x!) < Date.parse(`${r.due_on}T00:00:00Z`)).sort();
  return seen[0] ?? day0;
}

export function visibilityOutcomes(rechecks: OutcomeRecheck[], runs: OutcomeRun[], results: OutcomeResult[], checkedAt: Map<string, string>): Outcome[] {
  const complete = runs.filter((r) => r.status === "complete").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const byRun = new Map<string, OutcomeResult[]>();
  for (const r of results) byRun.set(r.run_id, [...(byRun.get(r.run_id) ?? []), r]);

  return [...rechecks].sort((a, b) => a.due_on.localeCompare(b.due_on)).map((r) => {
    const at = fixedAt(r, checkedAt);
    const base = { day: r.day, due_on: r.due_on, fixedAt: at, fixes: r.finding_keys.length, before: null, after: null, gained: [], lost: [] };
    const beforeRun = [...complete].reverse().find((x) => x.created_at < at) ?? null;
    if (!r.job || r.job.status === "queued" || r.job.status === "running") return { ...base, state: "pending", basis: "unavailable", reason: `due on ${r.due_on}` } as Outcome;
    const afterRun = r.job.run_id ? complete.find((x) => x.id === r.job!.run_id) ?? null : null;
    if (r.job.status === "failed" || !afterRun) return { ...base, state: "failed", basis: "unavailable", reason: r.job.error ?? "the re-check run did not complete" } as Outcome;
    if (!beforeRun) return { ...base, state: "no_baseline", basis: "unavailable", reason: "no AI Visibility run before the fix to compare with" } as Outcome;

    const before = new Map((byRun.get(beforeRun.id) ?? []).filter(usable).map((x) => [keyOf(x), x]));
    const after = (byRun.get(afterRun.id) ?? []).filter(usable).filter((x) => before.has(keyOf(x)));
    if (!after.length) return { ...base, state: "no_overlap", basis: "unavailable", reason: "no question was answered both before the fix and on the re-check" } as Outcome;
    const pairs = after.map((x) => ({ prompt: x.prompt, was: before.get(keyOf(x))!.mentioned === true, now: x.mentioned === true }));
    const uniq = (xs: string[]) => [...new Set(xs)];
    return {
      ...base,
      state: "done",
      basis: "observed",
      reason: null,
      before: { runId: beforeRun.id, at: beforeRun.created_at, named: pairs.filter((p) => p.was).length, answered: pairs.length },
      after: { runId: afterRun.id, at: afterRun.created_at, named: pairs.filter((p) => p.now).length, answered: pairs.length },
      gained: uniq(pairs.filter((p) => !p.was && p.now).map((p) => p.prompt)),
      lost: uniq(pairs.filter((p) => p.was && !p.now).map((p) => p.prompt)),
    };
  });
}
