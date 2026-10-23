import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fixtures/fake-supabase";

vi.mock("server-only", () => ({}));
const { purgeOldHits, refreshIpRanges, verifyStoreHits } = await import("./bot-jobs");
const { JobYield } = await import("./jobs");

const anthropic = { creationTime: "2026-10-20T00:00:00Z", prefixes: [{ ipv4Prefix: "216.73.216.0/22" }] };

describe("bot verification jobs", () => {
  it("refresh: a good list is stored; a failed read keeps the last good list and says why", async () => {
    const { client, tables } = fakeSupabase({}, {}, { bot_ip_ranges: ["url"] });
    await refreshIpRanges(client, async (url) => (url.includes("claude.com") ? anthropic : { prefixes: [{ ipv4Prefix: "20.0.0.0/24" }] }));
    expect(tables.bot_ip_ranges.find((r) => String(r.url).includes("claude.com"))).toMatchObject({ status: "ok", cidrs: ["216.73.216.0/22"], creation_time: "2026-10-20T00:00:00Z" });
    const r = await refreshIpRanges(client, async (url) => {
      if (url.includes("claude.com")) throw new Error("HTTP 503");
      return { prefixes: [{ ipv4Prefix: "20.0.0.0/24" }] };
    });
    expect(r.find((x) => x.url.includes("claude.com"))).toEqual({ url: "https://claude.com/crawling/bots.json", status: "ok", prefixes: 1, reason: "HTTP 503" });
    expect(tables.bot_ip_ranges.find((x) => String(x.url).includes("claude.com"))).toMatchObject({ cidrs: ["216.73.216.0/22"], reason: "Last refresh failed: HTTP 503" });
    // Never read: unavailable, with the reason.
    const fresh = fakeSupabase({}, {}, { bot_ip_ranges: ["url"] });
    await refreshIpRanges(fresh.client, async () => "<html>");
    expect(fresh.tables.bot_ip_ranges.every((x) => x.status === "unavailable")).toBe(true);
  });

  it("verify: list match = verified, other IP = UA-only claim; yields when time is short", async () => {
    const { client, tables } = fakeSupabase({
      bot_ip_ranges: [{ url: "https://claude.com/crawling/bots.json", bots: ["ClaudeBot"], cidrs: ["216.73.216.0/22"], status: "ok" }],
      bot_hits: [
        { store_id: "s1", hit_id: "a", bot: "ClaudeBot", ip: "216.73.216.10", verified: null, created_at: "1" },
        { store_id: "s1", hit_id: "b", bot: "ClaudeBot", ip: "203.0.113.5", verified: null, created_at: "2" },
      ],
    });
    const ctx = { admin: client, job: {} as never, step: (async () => null) as never, timeLeft: () => 100_000 };
    await verifyStoreHits(ctx, "s1", async () => ({ hostnames: [], forward: async () => [] }));
    expect(tables.bot_hits.map((h) => [h.hit_id, h.verified, h.verify_method, h.ip])).toEqual([["a", true, "ip_range", "216.73.216.10"], ["b", false, null, null]]);
    await expect(verifyStoreHits({ ...ctx, timeLeft: () => 1000 }, "s1")).rejects.toBeInstanceOf(JobYield);
  });

  it("purge: hits past the store's retention are deleted, never kept past 90 days", async () => {
    const now = Date.parse("2026-10-23T00:00:00Z");
    const { client, tables } = fakeSupabase({
      stores: [{ id: "s1", bot_hit_retention_days: 365 }, { id: "s2", bot_hit_retention_days: 7 }],
      bot_hits: [
        { store_id: "s1", hit_id: "old", seen_at: "2026-07-01T00:00:00.000Z" },
        { store_id: "s1", hit_id: "new", seen_at: "2026-10-01T00:00:00.000Z" },
        { store_id: "s2", hit_id: "week", seen_at: "2026-10-10T00:00:00.000Z" },
      ],
    });
    await purgeOldHits(client, now);
    expect(tables.bot_hits.map((h) => h.hit_id)).toEqual(["new"]);
  });
});
