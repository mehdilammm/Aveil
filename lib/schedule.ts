// Weekly scheduled scans: which stores are due today.
const DAY_MS = 86_400_000;

export type StoreScanState = {
  storeId: string;
  lastCompleteAt: string | null; // latest complete scan, any trigger
  lastScheduledAt: string | null; // latest scheduled scan, any status
  running: boolean;
};

// Due when no complete scan in the last `days` (the plan's: 7 on Pro and Agency, 30 on Free), nothing is
// running, and no scheduled scan started today (UTC).
export function dueForWeeklyScan(s: StoreScanState, now: Date, days = 7): boolean {
  if (s.running) return false;
  const today = now.toISOString().slice(0, 10);
  if (s.lastScheduledAt && s.lastScheduledAt.slice(0, 10) === today) return false;
  if (!s.lastCompleteAt) return true;
  return now.getTime() - Date.parse(s.lastCompleteAt) >= days * DAY_MS;
}
