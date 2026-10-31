import type { FindingRow } from "./data";

// Identical findings shown as one card: "Brand missing on 15 products" instead of 15 cards. Groups keep the order of
// the input (already sorted for fixing), so a group sits where its most urgent finding was.
export type FindingGroup = { type: string; items: FindingRow[] };

export function groupByType(rows: FindingRow[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup>();
  for (const f of rows) {
    const g = groups.get(f.type);
    if (g) g.items.push(f);
    else groups.set(f.type, { type: f.type, items: [f] });
  }
  return [...groups.values()];
}

const RANK = { high: 0, medium: 1, low: 2 } as const;
export const groupSeverity = (g: FindingGroup) => g.items.reduce<FindingRow["severity"]>((s, f) => (RANK[f.severity] < RANK[s] ? f.severity : s), "low");

// Plain sentence for the merchant from the "plain" catalog; the scan's own title when the type has none yet.
export function plainSentence(t: { has: (key: string) => boolean; (key: string, values?: Record<string, string | number>): string }, g: FindingGroup) {
  return t.has(g.type) ? t(g.type, { n: g.items.length }) : g.items.length > 1 ? `${g.items[0].title} (${g.items.length})` : g.items[0].title;
}
