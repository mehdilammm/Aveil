import "server-only";
import { promises as dns } from "node:dns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IP_SOURCES, parseRanges, RETENTION_DEFAULT_DAYS, verifyHit } from "./bot-verify";
import { JobYield, type StepContext } from "./jobs";
import { guardedFetch } from "./safe-fetch";

const MAX_LIST_BYTES = 2_000_000;

// Reads each operator's published list. A failed read keeps the last good list and records why.
export async function refreshIpRanges(admin: SupabaseClient, fetchList: (url: string) => Promise<unknown> = fetchJson) {
  const out: { url: string; status: string; prefixes: number; reason: string | null }[] = [];
  for (const src of IP_SOURCES) {
    let reason: string | null = null;
    let parsed: ReturnType<typeof parseRanges> | null = null;
    try {
      parsed = parseRanges(await fetchList(src.url));
      if (!parsed.ok) reason = parsed.reason;
    } catch (err) {
      reason = err instanceof Error ? err.message.slice(0, 200) : "request failed";
    }
    if (parsed?.ok) {
      await admin.from("bot_ip_ranges").upsert({ url: src.url, provider: src.provider, bots: src.bots, cidrs: parsed.cidrs, creation_time: parsed.creationTime, status: "ok", reason: null, fetched_at: new Date().toISOString() });
      out.push({ url: src.url, status: "ok", prefixes: parsed.cidrs.length, reason: null });
    } else {
      const { data: prev } = await admin.from("bot_ip_ranges").select("cidrs").eq("url", src.url).maybeSingle();
      const kept = (prev?.cidrs as string[] | undefined)?.length ?? 0;
      await admin.from("bot_ip_ranges").upsert({ url: src.url, provider: src.provider, bots: src.bots, status: kept ? "ok" : "unavailable", reason: `Last refresh failed: ${reason}`.slice(0, 300), ...(kept ? {} : { cidrs: [] }) });
      out.push({ url: src.url, status: kept ? "ok" : "unavailable", prefixes: kept, reason });
    }
  }
  return out;
}

// Through the guarded fetcher; up to 2 redirects, each one checked again.
async function fetchJson(url: string): Promise<unknown> {
  let current = new URL(url);
  let res = await guardedFetch(current, { headers: { Accept: "application/json", "User-Agent": "AgentScope/0.3 (+bot verification)" }, timeoutMs: 15_000 });
  for (let hop = 0; hop < 2 && res.status >= 300 && res.status < 400 && res.headers.get("location"); hop++) {
    current = new URL(res.headers.get("location")!, current);
    res = await guardedFetch(current, { headers: { Accept: "application/json", "User-Agent": "AgentScope/0.3 (+bot verification)" }, timeoutMs: 15_000 });
  }
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_LIST_BYTES) throw new Error("list too large");
  return JSON.parse(text);
}

async function rdns(ip: string) {
  const hostnames = await dns.reverse(ip);
  return {
    hostnames,
    forward: async (host: string) => {
      const [v4, v6] = await Promise.all([dns.resolve4(host).catch(() => []), dns.resolve6(host).catch(() => [])]);
      return [...v4, ...v6];
    },
  };
}

export async function rangesByBot(admin: SupabaseClient): Promise<Map<string, string[]>> {
  const { data } = await admin.from("bot_ip_ranges").select("bots, cidrs").eq("status", "ok");
  const m = new Map<string, string[]>();
  for (const r of data ?? []) for (const b of r.bots as string[]) m.set(b, [...(m.get(b) ?? []), ...(r.cidrs as string[])]);
  return m;
}

const BATCH = 200;

// Verifies the store's new hits, batch by batch, until none is left or the tick's time is used.
export async function verifyStoreHits(ctx: StepContext, storeId: string, lookup: typeof rdns = rdns) {
  const { admin, timeLeft } = ctx;
  const ranges = await rangesByBot(admin);
  let total = 0;
  for (;;) {
    if (timeLeft() < 30_000) throw new JobYield();
    const { data: hits } = await admin.from("bot_hits").select("hit_id, bot, ip").eq("store_id", storeId).is("verified", null).order("created_at").limit(BATCH);
    if (!hits?.length) break;
    for (const h of hits) {
      const v = await verifyHit({ bot: h.bot, ip: String(h.ip) }, ranges, (ip) => withTimeout(lookup(ip), 3000));
      await admin.from("bot_hits").update({ verified: v.verified, verify_method: v.method, verify_detail: v.detail, verified_at: new Date().toISOString() }).eq("store_id", storeId).eq("hit_id", h.hit_id);
    }
    total += hits.length;
  }
  return { verified: total };
}

const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

// Deletes hits older than each store's retention (default 90 days).
export async function purgeOldHits(admin: SupabaseClient, now = Date.now()) {
  const { data: stores } = await admin.from("stores").select("id, bot_hit_retention_days");
  let stores_ = 0;
  for (const s of stores ?? []) {
    const days = Number(s.bot_hit_retention_days ?? RETENTION_DEFAULT_DAYS);
    await admin.from("bot_hits").delete().eq("store_id", s.id).lt("seen_at", new Date(now - days * 86_400_000).toISOString());
    stores_++;
  }
  return { stores: stores_ };
}
