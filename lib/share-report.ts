// Shareable report (G3): a frozen, safe snapshot of one scan. Only what is safe to show anyone with the link:
// store name and domain, scan date, counts, and each finding's title, severity, basis and area. Evidence and
// guidance are left out (they can carry settings values, page URLs with parameters or other details).
import { createHash, randomBytes } from "node:crypto";
import { areaOf, AREAS } from "./categories";

export const SHARE_DAYS = [7, 30, 90] as const;
export type ShareSnapshot = {
  version: 1;
  store: { name: string; host: string };
  scan: { finished_at: string | null; scanned_products: number | null };
  counts: { high: number; medium: number; low: number; unavailable: number };
  areas: { key: string; label: string; open: number }[];
  findings: { title: string; severity: "high" | "medium" | "low"; basis: "observed" | "heuristic" | "unavailable"; area: string }[];
  // Agency client reports: the workspace that prepared it.
  preparedBy?: string;
};

export function newShareToken(): { token: string; hash: string } {
  const token = `agsr_${randomBytes(24).toString("base64url")}`;
  return { token, hash: hashShareToken(token) };
}
export const hashShareToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const isShareToken = (t: string) => /^agsr_[A-Za-z0-9_-]{32}$/.test(t);

type F = { title: string; type: string; finding_key: string; severity: "high" | "medium" | "low"; basis: "observed" | "heuristic" | "unavailable"; product_id: number | null };

export function buildSnapshot(store: { name: string; url: string }, scan: { finished_at: string | null; scanned_products: number | null }, findings: F[], preparedBy?: string): ShareSnapshot {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const list = [...findings].sort((a, b) => rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title));
  return {
    version: 1,
    store: { name: store.name.slice(0, 120), host: new URL(store.url).host },
    scan: { finished_at: scan.finished_at, scanned_products: scan.scanned_products },
    counts: {
      high: findings.filter((f) => f.severity === "high" && f.basis !== "unavailable").length,
      medium: findings.filter((f) => f.severity === "medium" && f.basis !== "unavailable").length,
      low: findings.filter((f) => f.severity === "low" && f.basis !== "unavailable").length,
      unavailable: findings.filter((f) => f.basis === "unavailable").length,
    },
    areas: AREAS.map((a) => ({ key: a.key, label: a.label, open: findings.filter((f) => areaOf(f) === a.key).length })),
    findings: list.map((f) => ({ title: f.title.slice(0, 200), severity: f.severity, basis: f.basis, area: areaOf(f) })),
    ...(preparedBy ? { preparedBy: preparedBy.slice(0, 80) } : {}),
  };
}

export function shareState(row: { expires_at: string; revoked_at: string | null } | null, now = Date.now()): "ok" | "expired" | "revoked" | "missing" {
  if (!row) return "missing";
  if (row.revoked_at) return "revoked";
  return Date.parse(row.expires_at) > now ? "ok" : "expired";
}
