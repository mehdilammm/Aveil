// Traffic ingest: daily totals sent by the agentscope-core WordPress plugin, signed with HMAC-SHA256.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_ROWS = 1000;
export const MAX_CLOCK_SKEW_SECONDS = 300;

export type TrafficRow = {
  day: string;
  source: string;
  category: string;
  confidence: string;
  route: string;
  http_status: number;
  hits: number;
  last_seen: string | null;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Signature header: "sha256=<hex>" of HMAC-SHA256(token, "<timestamp>.<raw body>").
export function sign(token: string, timestamp: string, body: string): string {
  return "sha256=" + createHmac("sha256", token).update(`${timestamp}.${body}`).digest("hex");
}

export function verifySignature(token: string, timestamp: string, body: string, header: string | null, nowSeconds: number): boolean {
  if (!header || !/^\d{9,11}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) return false;
  const expected = Buffer.from(sign(token, timestamp, body));
  const given = Buffer.from(header.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Same limits as the plugin's agsc_traffic table.
const TEXT_LIMITS = { source: 40, category: 30, confidence: 30, route: 30 } as const;
const TEXT_RE = /^[A-Za-z0-9 ._:\/()+-]+$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const DAY_MS = 86_400_000;

export function validateRows(input: unknown, now: Date): { rows: TrafficRow[] } | { error: string } {
  if (!input || typeof input !== "object" || !Array.isArray((input as { rows?: unknown }).rows)) return { error: "Body must be {\"rows\": [...]}" };
  const raw = (input as { rows: unknown[] }).rows;
  if (raw.length > MAX_ROWS) return { error: `At most ${MAX_ROWS} rows per request` };

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const seen = new Set<string>();
  const rows: TrafficRow[] = [];
  for (const [i, r] of raw.entries()) {
    if (!r || typeof r !== "object") return { error: `Row ${i}: not an object` };
    const row = r as Record<string, unknown>;

    const day = String(row.day ?? "");
    const dayMs = DAY_RE.test(day) ? Date.parse(`${day}T00:00:00Z`) : NaN;
    if (!Number.isFinite(dayMs) || new Date(dayMs).toISOString().slice(0, 10) !== day) return { error: `Row ${i}: day must be YYYY-MM-DD` };
    if (dayMs > today + DAY_MS || dayMs < today - 400 * DAY_MS) return { error: `Row ${i}: day is out of range` };

    const text: Record<string, string> = {};
    for (const [key, max] of Object.entries(TEXT_LIMITS)) {
      const v = typeof row[key] === "string" ? (row[key] as string).trim() : "";
      if (!v || v.length > max || !TEXT_RE.test(v)) return { error: `Row ${i}: ${key} must be 1-${max} plain characters` };
      text[key] = v;
    }

    const status = Number(row.http_status ?? 0);
    if (!Number.isInteger(status) || !(status === 0 || (status >= 100 && status <= 599))) return { error: `Row ${i}: http_status must be 0 or 100-599` };
    const hits = Number(row.hits);
    if (!Number.isInteger(hits) || hits < 0 || hits > 10_000_000) return { error: `Row ${i}: hits must be a whole number from 0 to 10000000` };

    let lastSeen: string | null = null;
    if (row.last_seen !== undefined && row.last_seen !== null && row.last_seen !== "") {
      const s = String(row.last_seen);
      // The plugin stores UTC "YYYY-MM-DD HH:MM:SS" without a zone.
      const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s.replace(" ", "T") : `${s.replace(" ", "T")}Z`;
      if (!DATETIME_RE.test(s) || !Number.isFinite(Date.parse(iso))) return { error: `Row ${i}: last_seen must be a date and time` };
      lastSeen = new Date(iso).toISOString();
    }

    const key = [day, text.source, text.category, text.confidence, text.route, status].join("|");
    if (seen.has(key)) return { error: `Row ${i}: duplicate bucket` };
    seen.add(key);
    rows.push({ day, source: text.source, category: text.category, confidence: text.confidence, route: text.route, http_status: status, hits, last_seen: lastSeen });
  }
  return { rows };
}

// Requests the plugin (1.2.0+) marked as a burst of several AI bots within a minute: probably an SEO/GEO checker tool.
// HEURISTIC: shown apart and left out of the main numbers.
export const CHECKER_CONFIDENCE = "likely-checker-tool";

export function splitCheckerRows<T extends { confidence: string }>(rows: T[]): { main: T[]; checker: T[] } {
  return { main: rows.filter((r) => r.confidence !== CHECKER_CONFIDENCE), checker: rows.filter((r) => r.confidence === CHECKER_CONFIDENCE) };
}
