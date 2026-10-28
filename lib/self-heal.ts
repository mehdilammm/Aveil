// G9 self-healing and G10 auto-rollback: the decisions, pure (the reads and writes are in self-heal-run.ts).
//   G9  An applied plugin fix of ours that is gone (no longer stored by the plugin, or its finding is back) is put
//       back once with the same payload, verified, logged `reapplied` and notified. Gone again after that: an alert
//       and nothing more (no loop), and auto-fix does not create it again. Fixes written with the write key are
//       never put back: a value that changed there was changed by someone, usually the merchant.
//   G10 A new problem the breakage check finds on the page / field one of our fixes changed in the last 7 days:
//       that fix is undone without waiting, verified and notified. Only when the store still shows what we wrote
//       (a value changed since is the merchant's, and stays).

export type AuditRow = {
  id: string;
  finding_key: string;
  kind: string;
  channel: string;
  target: string;
  status: string;
  after: Record<string, unknown> | null;
  applied_at: string;
  reapplied_of: string | null;
};

export const HEAL_WINDOW_MS = 24 * 3_600_000;
export const ROLLBACK_WINDOW_MS = 7 * 86_400_000;

export const fixIdOf = (r: AuditRow) => String(r.after?.fix_id ?? r.id);
// Kinds the plugin keeps one of per store (a newer one replaces the older); brand fixes are one per product.
const ONE_PER_STORE = new Set(["llms_txt", "robots", "feed", "org", "website", "breadcrumbs", "shipping", "variants", "returns"]);
const slotOf = (r: AuditRow) => (ONE_PER_STORE.has(r.kind) ? r.kind : `${r.kind}:${r.target}`);

// The applied plugin fixes that are the current one of their slot (an older fix of the same part was replaced).
export function currentPluginFixes(rows: AuditRow[]): AuditRow[] {
  const latest = new Map<string, AuditRow>();
  for (const r of rows) {
    if (r.channel !== "plugin" || r.reapplied_of || (r.status !== "applied" && r.status !== "reverted")) continue;
    const k = slotOf(r);
    const prev = latest.get(k);
    if (!prev || r.applied_at > prev.applied_at) latest.set(k, r);
  }
  return [...latest.values()].filter((r) => r.status === "applied");
}

export type HealDecision =
  | { row: AuditRow; action: "reapply"; why: string }
  | { row: AuditRow; action: "lost"; why: string }
  | { row: AuditRow; action: "wait"; why: string };

// stored: fix ids the plugin reports (null = the plugin could not be asked: nothing is decided). back: finding keys
// the check that just ran found, and when it started (a fix applied after that is not "back"). alerted: audit ids
// that already have a fix_lost alert.
export function healPlan(rows: AuditRow[], stored: Set<string> | null, back: { keys: Set<string>; at: number }, alerted: Set<string>, now: number): HealDecision[] {
  if (!stored) return [];
  const out: HealDecision[] = [];
  for (const row of currentPluginFixes(rows)) {
    const missing = !stored.has(fixIdOf(row));
    const returned = back.keys.has(row.finding_key) && Date.parse(row.applied_at) < back.at;
    if (!missing && !returned) continue;
    const why = missing ? "the plugin no longer has this fix" : "the check finds the problem again";
    const reapplies = rows.filter((r) => r.reapplied_of === row.id).sort((a, b) => b.applied_at.localeCompare(a.applied_at));
    if (!reapplies.length) out.push({ row, action: "reapply", why });
    else if (now - Date.parse(reapplies[0].applied_at) < HEAL_WINDOW_MS && !missing) out.push({ row, action: "wait", why: "put back less than 24 hours ago; the next check decides" });
    else if (!alerted.has(row.id)) out.push({ row, action: "lost", why: `${why} after it was put back once` });
  }
  return out;
}

// What one of our fixes changed, as a test on a breakage problem (its type and evidence).
const TOUCHES: Record<string, (p: { type: string; evidence: string }) => boolean> = {
  shipping: (p) => p.type.startsWith("schema_") && /shipping/i.test(p.evidence),
  returns: (p) => p.type.startsWith("schema_") && /return/i.test(p.evidence),
  variants: (p) => p.type.startsWith("schema_") && /offer|variant/i.test(p.evidence),
  breadcrumbs: (p) => p.type.startsWith("schema_") && /breadcrumb/i.test(p.evidence),
  org: (p) => p.type.startsWith("schema_") && /organi[sz]ation|seller|publisher/i.test(p.evidence),
  brand: (p) => p.type.startsWith("schema_") && /brand/i.test(p.evidence),
  robots: (p) => p.type === "robots_blocks_bot",
  sell_where_ship: (p) => p.type.startsWith("checkout_") && /countr|ship|deliver/i.test(p.evidence),
  guest_checkout: (p) => p.type.startsWith("checkout_") && /guest|account|log ?in/i.test(p.evidence),
};

export type Rollback = { row: AuditRow; problem: { finding_key: string; type: string; title: string; evidence: string; product_id: number | null } };

// Our fixes applied in the last 7 days that a new problem points to (same page for product fixes). Each fix at
// most once; the newest fix first when several match one problem.
export function rollbackPlan(rows: AuditRow[], problems: Rollback["problem"][], now: number): Rollback[] {
  const recent = rows.filter((r) => r.status === "applied" && now - Date.parse(r.applied_at) < ROLLBACK_WINDOW_MS).sort((a, b) => b.applied_at.localeCompare(a.applied_at));
  const out: Rollback[] = [];
  const taken = new Set<string>();
  for (const problem of problems) {
    for (const row of recent) {
      if (taken.has(row.id) || !TOUCHES[row.kind]?.(problem)) continue;
      const product = /^product:(\d+)$/.exec(row.target)?.[1];
      if (product && problem.product_id !== null && Number(product) !== problem.product_id) continue;
      out.push({ row, problem });
      taken.add(row.id);
      break;
    }
  }
  return out;
}
