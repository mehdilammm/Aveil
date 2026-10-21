// Compares a scan with earlier scans of the same store.

export type FindingState = "new" | "ongoing" | "recurred";

// previousKeys: findings of the latest earlier complete scan.
// everSeenKeys: findings of any earlier complete scan.
export function findingState(key: string, previousKeys: Set<string>, everSeenKeys: Set<string>): FindingState {
  if (previousKeys.has(key)) return "ongoing";
  if (everSeenKeys.has(key)) return "recurred";
  return "new";
}

// Keys present in the previous scan and gone from the current one.
export function resolvedKeys(currentKeys: Set<string>, previousKeys: Set<string>): string[] {
  return [...previousKeys].filter((key) => !currentKeys.has(key));
}

export type ScanDelta = { scanId: string; new: number; ongoing: number; recurred: number; resolved: number };

// Per-scan counts for a list of complete scans, oldest first. States are recomputed from the keys,
// so the result does not depend on what was stored at scan time.
export function scanDeltas(scans: { id: string; keys: string[] }[]): ScanDelta[] {
  const ever = new Set<string>();
  let previous = new Set<string>();
  return scans.map((scan) => {
    const current = new Set(scan.keys);
    const delta: ScanDelta = { scanId: scan.id, new: 0, ongoing: 0, recurred: 0, resolved: resolvedKeys(current, previous).length };
    for (const key of current) delta[findingState(key, previous, ever)]++;
    for (const key of current) ever.add(key);
    previous = current;
    return delta;
  });
}
