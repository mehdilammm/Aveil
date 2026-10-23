// Validation of the bot hits the plugin sends (POST /api/ingest/bot-hits). Pure.
import { isIP } from "node:net";
import { botOfUa } from "./bot-verify";

export const MAX_HITS = 500;
export type BotHit = { hit_id: string; seen_at: string; bot: string; ip: string; user_agent: string; url_path: string; method: "GET" | "HEAD" | "POST"; http_status: number | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only hits whose user agent is a known AI bot are accepted (the plugin never sends human visitors; this checks it).
export function validateHits(input: unknown, now: Date): { hits: BotHit[]; skipped: number } | { error: string } {
  const list = (input as { hits?: unknown })?.hits;
  if (!Array.isArray(list)) return { error: "Body must be {\"hits\": [...]}" };
  if (list.length > MAX_HITS) return { error: `At most ${MAX_HITS} hits per request` };
  const hits: BotHit[] = [];
  let skipped = 0;
  for (const raw of list) {
    const h = raw as Record<string, unknown>;
    const ua = typeof h.user_agent === "string" ? h.user_agent.slice(0, 500) : "";
    const bot = botOfUa(ua);
    const seen = typeof h.seen_at === "string" ? Date.parse(h.seen_at) : NaN;
    const ip = typeof h.ip === "string" ? h.ip.trim() : "";
    const path = typeof h.url_path === "string" ? h.url_path : "";
    const method = String(h.method ?? "GET").toUpperCase();
    if (
      !bot || typeof h.hit_id !== "string" || !UUID_RE.test(h.hit_id) || !isIP(ip) || !Number.isFinite(seen) ||
      seen > now.getTime() + 300_000 || seen < now.getTime() - 30 * 86_400_000 || !path.startsWith("/") || !["GET", "HEAD", "POST"].includes(method)
    ) {
      skipped++;
      continue;
    }
    const status = Number(h.http_status);
    hits.push({
      hit_id: h.hit_id.toLowerCase(),
      seen_at: new Date(seen).toISOString(),
      bot,
      ip,
      user_agent: ua,
      url_path: path.split("?")[0].slice(0, 500),
      method: method as BotHit["method"],
      http_status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    });
  }
  return { hits, skipped };
}
