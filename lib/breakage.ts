// F2: what a store change may have broken. A mini-scan (bot access, robots.txt, structured data on 3 products,
// checkout) is compared with the last full scan; a problem it finds that the full scan did not have is new.
// The problem is Observed; that the change caused it is only Likely (Heuristic), since other things can change too.
import type { Finding } from "./rules";

// Finding types a plugin, theme or core update can break from one day to the next.
const BREAKABLE = [/^access_(blocked|degraded|rate_limited)$/, /^robots_blocks_bot$/, /^schema_/, /^checkout_(blocked_bots|rate_limited_bots|captcha|guest_disabled|no_payment|no_shipping_method)$/, /^store_(maintenance_mode|coming_soon)$/];
export const isBreakable = (type: string) => BREAKABLE.some((re) => re.test(type));

export type Change = { kind: string; subject: string | null; old_version: string | null; new_version: string | null; occurred_at: string };
export type Problem = { finding_key: string; type: string; title: string; evidence: string; severity: string; basis: string };
export type BreakageDetail = { change: Change; changes: number; problems: Problem[]; compared_scan_id: string | null };

export function newProblems(mini: Finding[], lastScan: { finding_key: string; basis: string }[]): Problem[] {
  const before = new Set(lastScan.filter((f) => f.basis !== "unavailable").map((f) => f.finding_key));
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return mini
    .filter((f) => isBreakable(f.type) && f.basis !== "unavailable" && !before.has(f.finding_key))
    .sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3))
    .map((f) => ({ finding_key: f.finding_key, type: f.type, title: f.title.slice(0, 200), evidence: f.evidence.slice(0, 500), severity: f.severity, basis: f.basis }));
}

// The change to name as the likely cause: the latest one before the mini-scan (an update first, if any).
export function likelyCause(changes: Change[]): Change | null {
  const sorted = [...changes].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  return sorted.find((c) => c.kind.endsWith("_updated")) ?? sorted[0] ?? null;
}

export function breakageAlert(changes: Change[], problems: Problem[], comparedScanId: string | null): { title: string; detail: BreakageDetail } | null {
  const cause = likelyCause(changes);
  if (!cause || !problems.length) return null;
  const what = cause.subject ?? cause.kind;
  const versions = cause.old_version || cause.new_version ? ` (${cause.old_version ?? "?"} → ${cause.new_version ?? "?"})` : "";
  return {
    title: `After ${cause.kind.replace("_", " ")} ${what}${versions}: ${problems[0].title}`.slice(0, 300),
    detail: { change: cause, changes: changes.length, problems: problems.slice(0, 10), compared_scan_id: comparedScanId },
  };
}

// The latest breakage check, shown on the Alerts page even when it found nothing, so the owner knows it ran.
export type LastCheck =
  | { state: "pending"; change: Change | null; at: string }
  | { state: "clean"; change: Change | null; at: string; checked: number }
  | { state: "alert"; change: Change | null; at: string; problems: number }
  | { state: "failed"; change: Change | null; at: string; error: string };

export function lastCheck(job: { status: string; updated_at: string; run_after: string | null; error: string | null } | null, changes: Change[], result: { checked?: number; new_problems?: number } | null): LastCheck | null {
  if (!job) return null;
  const change = likelyCause(changes);
  if (job.status === "queued" || job.status === "running") return { state: "pending", change, at: job.run_after ?? job.updated_at };
  if (job.status === "failed" || job.status === "cancelled") return { state: "failed", change, at: job.updated_at, error: (job.error ?? "the check did not finish").slice(0, 300) };
  if (!result) return { state: "failed", change, at: job.updated_at, error: "no result was recorded" };
  return (result.new_problems ?? 0) > 0
    ? { state: "alert", change, at: job.updated_at, problems: result.new_problems ?? 0 }
    : { state: "clean", change, at: job.updated_at, checked: result.checked ?? 0 };
}
