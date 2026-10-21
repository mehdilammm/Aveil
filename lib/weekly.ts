// Weekly report: what was fixed, what is new and what came back, between a scan about a week ago and the latest one.
const WEEK_MS = 7 * 86_400_000;

export type KeyedScan = { id: string; finishedAt: string; keys: string[] };

export type WeeklySummary = {
  fromScanId: string;
  toScanId: string;
  fromDate: string;
  toDate: string;
  fixed: string[];
  added: string[];
  recurred: string[];
  open: number;
};

// scans: complete scans, oldest first. Baseline: the latest scan at least 7 days before the newest,
// or the oldest scan when the history is shorter than a week. Null with fewer than two scans.
export function weeklySummary(scans: KeyedScan[]): WeeklySummary | null {
  if (scans.length < 2) return null;
  const to = scans[scans.length - 1];
  const cutoff = Date.parse(to.finishedAt) - WEEK_MS;
  let fromIndex = 0;
  scans.forEach((s, i) => {
    if (i < scans.length - 1 && Date.parse(s.finishedAt) <= cutoff) fromIndex = i;
  });
  const from = scans[fromIndex];
  const fromKeys = new Set(from.keys);
  const toKeys = new Set(to.keys);
  const seenBefore = new Set(scans.slice(0, fromIndex + 1).flatMap((s) => s.keys));
  const added: string[] = [];
  const recurred: string[] = [];
  for (const k of toKeys) {
    if (fromKeys.has(k)) continue;
    (seenBefore.has(k) ? recurred : added).push(k);
  }
  return {
    fromScanId: from.id,
    toScanId: to.id,
    fromDate: from.finishedAt,
    toDate: to.finishedAt,
    fixed: [...fromKeys].filter((k) => !toKeys.has(k)),
    added,
    recurred,
    open: toKeys.size,
  };
}
