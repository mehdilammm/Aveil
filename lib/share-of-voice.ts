// Share of voice: in how many of the run's questions each name appears. Counts only, no invented score.
import { normalizeName } from "./visibility";

export type SovRow = { run_id: string; mentioned: boolean | null; competitors: string[]; answered: boolean };
export type SovEntry = { name: string; isStore: boolean; questions: number };
export type SovRun = { runId: string; date: string; answered: number; unavailable: number; entries: SovEntry[] };

// One run: answered = questions with an answer (errors are counted apart, never as "not mentioned").
// Each name counts at most once per question. Sorted by questions, the store placed by its count like the others.
export function shareOfVoice(storeName: string, runId: string, date: string, rows: SovRow[]): SovRun {
  const answered = rows.filter((r) => r.answered);
  const counts = new Map<string, SovEntry>();
  let store = 0;
  for (const r of answered) {
    if (r.mentioned) store++;
    for (const key of new Set(r.competitors.map((c) => normalizeName(c)).filter(Boolean))) {
      const name = r.competitors.find((c) => normalizeName(c) === key)!;
      const e = counts.get(key) ?? { name, isStore: false, questions: 0 };
      e.questions++;
      counts.set(key, e);
    }
  }
  const entries = [{ name: storeName, isStore: true, questions: store }, ...counts.values()].sort(
    (a, b) => b.questions - a.questions || Number(b.isStore) - Number(a.isStore) || a.name.localeCompare(b.name),
  );
  return { runId, date, answered: answered.length, unavailable: rows.length - answered.length, entries };
}

// Position of the store among all names (1 = named in the most questions; ties share the better position).
export function storePosition(run: SovRun): number | null {
  const s = run.entries.find((e) => e.isStore);
  if (!s || s.questions === 0) return null;
  return run.entries.filter((e) => e.questions > s.questions).length + 1;
}
