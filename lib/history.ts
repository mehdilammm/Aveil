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
