// The case study's numbers, copied from the database (demo store 3b2c4336…, a copy of matha.site's data; every complete
// scan, finished_at / findings_count / findings with severity "high"), read on 2026-11-06. Nothing here is estimated.
export const CASE_SCANS: { at: string; issues: number; critical: number }[] = [
  { at: "2026-10-20T22:18:17Z", issues: 16, critical: 1 },
  { at: "2026-10-21T06:41:50Z", issues: 19, critical: 1 },
  { at: "2026-10-21T06:52:48Z", issues: 19, critical: 1 },
  { at: "2026-10-21T06:57:15Z", issues: 18, critical: 1 },
  { at: "2026-10-21T07:19:55Z", issues: 46, critical: 14 },
  { at: "2026-10-21T07:20:09Z", issues: 46, critical: 14 },
  { at: "2026-10-21T07:20:52Z", issues: 46, critical: 14 },
  { at: "2026-10-21T07:31:00Z", issues: 47, critical: 13 },
  { at: "2026-10-21T08:10:06Z", issues: 49, critical: 13 },
  { at: "2026-10-21T19:10:36Z", issues: 43, critical: 14 },
  { at: "2026-10-21T23:00:06Z", issues: 30, critical: 1 },
  { at: "2026-10-21T23:01:16Z", issues: 30, critical: 1 },
  { at: "2026-10-21T23:12:46Z", issues: 19, critical: 1 },
  { at: "2026-10-22T09:00:31Z", issues: 19, critical: 1 },
  { at: "2026-10-22T23:43:52Z", issues: 24, critical: 2 },
  { at: "2026-10-23T06:58:00Z", issues: 24, critical: 1 },
  { at: "2026-10-23T19:25:53Z", issues: 20, critical: 0 },
  { at: "2026-10-24T08:16:59Z", issues: 21, critical: 0 },
  { at: "2026-10-27T20:51:02Z", issues: 22, critical: 0 },
  { at: "2026-10-28T19:10:06Z", issues: 27, critical: 0 },
  // The market check of 28 Oct added 4 items for the United States (2 critical: not sold there, no shipping method;
  // 2 notes). The store sells only to Morocco by choice, so with target markets (2026-11-07) the US is one
  // information item: 23 + 1 = 24 issues, 0 critical (before the rule: 23 + 4 = 27 rows, 2 critical).
  { at: "2026-10-28T22:17:05Z", issues: 24, critical: 0 },
];
// The before/after the text quotes: the scan of 21 Oct 19:10 (43, 14 critical), 23:12 the same night (19), 23 Oct 19:25 (0 critical).
export const CASE_BEFORE = { issues: 43, critical: 14 };
export const CASE_AFTER = { issues: 19, critical: 0 };

// The Store API purchase tests of 2026-10-27 (job_steps results), step by step. No order is ever placed.
export type CaseStep = { step: "robots" | "products" | "cart" | "add" | "address" | "shipping" | "payment" | "order" | "cleanup"; outcome: "ok" | "warn" | "stop" | "skip" };
export const CASE_SIM: { market: "US" | "MA"; stoppedAt: CaseStep["step"] | null; steps: CaseStep[] }[] = [
  { market: "US", stoppedAt: "shipping", steps: [
    { step: "robots", outcome: "ok" }, { step: "products", outcome: "ok" }, { step: "cart", outcome: "ok" }, { step: "add", outcome: "ok" },
    { step: "address", outcome: "ok" }, { step: "shipping", outcome: "stop" }, { step: "cleanup", outcome: "ok" },
  ] },
  { market: "MA", stoppedAt: null, steps: [
    { step: "robots", outcome: "ok" }, { step: "products", outcome: "ok" }, { step: "cart", outcome: "ok" }, { step: "add", outcome: "ok" },
    { step: "address", outcome: "ok" }, { step: "shipping", outcome: "ok" }, { step: "payment", outcome: "warn" }, { step: "order", outcome: "skip" }, { step: "cleanup", outcome: "ok" },
  ] },
];
