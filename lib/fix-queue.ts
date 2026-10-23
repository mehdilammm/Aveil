// Prioritized fix queue (C4): score = (Impact × Confidence) / Effort, with every weight shown and adjustable.
// Impact = severity weight × scope (store-wide findings touch every product); Confidence = Observed 1.0,
// Heuristic 0.5; Unavailable findings are left out (nothing to fix yet, only to check). Effort is the usual work
// for that kind of fix (1 a setting or a copied file, 2 content in the store, 3 a developer or host change).
import type { Basis, Severity } from "./rules";

export type Weights = { severity: Record<Severity, number>; storeWide: number; confidence: Record<Exclude<Basis, "unavailable">, number> };
export const DEFAULT_WEIGHTS: Weights = { severity: { high: 3, medium: 2, low: 1 }, storeWide: 2, confidence: { observed: 1, heuristic: 0.5 } };

const EFFORT: [RegExp, 1 | 2 | 3][] = [
  [/^(robots_|llms_txt|checkout_guest_disabled|store_coming_soon|price_|sale_price|image_missing|weight_missing|stock_)/, 1],
  [/^(schema_|access_|bot_protection|checkout_(blocked|rate_limited)_bots|checkout_captcha|checkout_offline_payment_only|checkout_no_payment)/, 3],
];
export const effortOf = (type: string): 1 | 2 | 3 => EFFORT.find(([re]) => re.test(type))?.[1] ?? 2;

export type QueueItem<F> = { finding: F; impact: number; confidence: number; effort: number; score: number; group: "store" | "high_value" | "product" };
type F = { finding_key: string; type: string; severity: Severity; basis: Basis; product_id: number | null };

// highValue: products of the scan's sample (best sellers first, else one per category).
export function fixQueue<T extends F>(findings: T[], highValue: Set<number>, w: Weights = DEFAULT_WEIGHTS): QueueItem<T>[] {
  return findings
    .filter((f) => f.basis !== "unavailable")
    .map((f) => {
      const impact = w.severity[f.severity] * (f.product_id === null ? w.storeWide : 1);
      const confidence = w.confidence[f.basis as "observed" | "heuristic"];
      const effort = effortOf(f.type);
      const group: QueueItem<T>["group"] = f.product_id === null ? "store" : highValue.has(f.product_id) ? "high_value" : "product";
      return { finding: f, impact, confidence, effort, score: Math.round(((impact * confidence) / effort) * 100) / 100, group };
    })
    .sort((a, b) => b.score - a.score || a.finding.finding_key.localeCompare(b.finding.finding_key));
}

// Weights from the page's query string, kept in bounds; anything missing or invalid uses the default.
export function weightsFrom(q: Record<string, string | undefined>): Weights {
  const num = (v: string | undefined, d: number, min: number, max: number) => {
    const n = Number(v);
    return v !== undefined && v !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  const d = DEFAULT_WEIGHTS;
  return {
    severity: { high: num(q.w_high, d.severity.high, 0, 10), medium: num(q.w_medium, d.severity.medium, 0, 10), low: num(q.w_low, d.severity.low, 0, 10) },
    storeWide: num(q.w_store, d.storeWide, 1, 10),
    confidence: { observed: 1, heuristic: num(q.w_heuristic, d.confidence.heuristic, 0, 1) },
  };
}
