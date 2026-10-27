// Bot → product map (F1): for each published product, the AI bot visits to its own page in the window, per bot,
// verified against the official IP lists (Observed) or claimed by the user agent only (Heuristic), next to the
// product's open findings of the last scan. Cached pages never reach the plugin, so every count is a minimum.
import type { Basis } from "./rules";

export type MapProduct = { id: number; name: string; url: string };
export type MapHit = { bot: string; url_path: string; verified: boolean | null };
export type MapFinding = { product_id: number | null; title: string; severity: "high" | "medium" | "low"; basis: Basis };
export type BotCount = { bot: string; verified: number; claimed: number; pending: number };
export type MapClause = { msg: "visited" | "claimed" | "pending" | "issue" | "noIssue"; values: Record<string, string | number>; basis: Basis };
export type MapRow = { product: MapProduct; bots: BotCount[]; total: number; findings: MapFinding[]; clauses: MapClause[] };

// "/product/Round-LED/?x=1#a", "https://s/product/round-led" → "/product/round-led/".
export function normPath(input: string): string {
  let p = input;
  try {
    p = new URL(input, "https://x.invalid").pathname;
  } catch {
    p = input.split(/[?#]/)[0];
  }
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep as is */
  }
  p = p.toLowerCase();
  return p.endsWith("/") ? p : `${p}/`;
}

const RANK = { high: 0, medium: 1, low: 2 } as const;

export function botProductMap(products: MapProduct[], hits: MapHit[], findings: MapFinding[]) {
  const byPath = new Map(products.map((p) => [normPath(p.url), p]));
  const counts = new Map<number, Map<string, BotCount>>();
  const other = new Map<string, { path: string; verified: number; claimed: number; pending: number }>();
  for (const h of hits) {
    const path = normPath(h.url_path);
    const p = byPath.get(path);
    const kind = h.verified === true ? "verified" : h.verified === false ? "claimed" : "pending";
    if (!p) {
      const o = other.get(path) ?? { path: h.url_path.split(/[?#]/)[0].slice(0, 200), verified: 0, claimed: 0, pending: 0 };
      o[kind]++;
      other.set(path, o);
      continue;
    }
    const m = counts.get(p.id) ?? new Map<string, BotCount>();
    const c = m.get(h.bot) ?? { bot: h.bot, verified: 0, claimed: 0, pending: 0 };
    c[kind]++;
    m.set(h.bot, c);
    counts.set(p.id, m);
  }

  const open = (id: number) => findings.filter((f) => f.product_id === id && f.basis !== "unavailable").sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.title.localeCompare(b.title));
  const visited: MapRow[] = [];
  const unvisited: { product: MapProduct; findings: MapFinding[] }[] = [];
  for (const p of products) {
    const bots = [...(counts.get(p.id)?.values() ?? [])].sort((a, b) => b.verified - a.verified || b.claimed - a.claimed || a.bot.localeCompare(b.bot));
    const f = open(p.id);
    if (!bots.length) {
      unvisited.push({ product: p, findings: f });
      continue;
    }
    const total = bots.reduce((n, b) => n + b.verified + b.claimed + b.pending, 0);
    const top = bots[0];
    const clauses: MapClause[] = [];
    if (top.verified) clauses.push({ msg: "visited", values: { bot: top.bot, n: top.verified }, basis: "observed" });
    if (top.claimed) clauses.push({ msg: "claimed", values: { bot: top.bot, n: top.claimed }, basis: "heuristic" });
    if (top.pending) clauses.push({ msg: "pending", values: { bot: top.bot, n: top.pending }, basis: "unavailable" });
    clauses.push(f.length ? { msg: "issue", values: { title: f[0].title, more: f.length - 1 }, basis: f[0].basis } : { msg: "noIssue", values: {}, basis: "observed" });
    visited.push({ product: p, bots, total, findings: f, clauses });
  }
  visited.sort((a, b) => b.total - a.total || a.product.name.localeCompare(b.product.name));
  const otherPages = [...other.values()].sort((a, b) => b.verified + b.claimed + b.pending - (a.verified + a.claimed + a.pending)).slice(0, 10);
  return { visited, unvisited, otherPages };
}
