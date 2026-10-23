import { describe, expect, it } from "vitest";
import { validateHits } from "./bot-hits";

const now = new Date("2026-10-23T10:00:00Z");
const hit = (over: Record<string, unknown> = {}) => ({
  hit_id: "0b0c7c3e-2f4a-4b8e-9a51-1d2e3f4a5b6c",
  seen_at: "2026-10-23T09:59:00Z",
  ip: "216.73.216.10",
  user_agent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  url_path: "/product/round-led-mirror/?utm_source=x&email=a@b.co",
  method: "GET",
  http_status: 200,
  ...over,
});

describe("bot hits from the plugin", () => {
  it("keeps a known bot's hit; the query string is dropped", () => {
    expect(validateHits({ hits: [hit()] }, now)).toEqual({
      hits: [{ hit_id: "0b0c7c3e-2f4a-4b8e-9a51-1d2e3f4a5b6c", seen_at: "2026-10-23T09:59:00.000Z", bot: "ClaudeBot", ip: "216.73.216.10", user_agent: hit().user_agent, url_path: "/product/round-led-mirror/", method: "GET", http_status: 200 }],
      skipped: 0,
    });
  });

  it("a human browser, a bad IP, a time in the future or a bad id is never stored", () => {
    const r = validateHits({ hits: [hit({ user_agent: "Mozilla/5.0 (iPhone) Safari/604.1" }), hit({ ip: "not-an-ip" }), hit({ seen_at: "2026-10-24T10:00:00Z" }), hit({ hit_id: "x" }), hit({ url_path: "https://x/" })] }, now);
    expect(r).toEqual({ hits: [], skipped: 5 });
  });

  it("body shape and size", () => {
    expect(validateHits({}, now)).toEqual({ error: "Body must be {\"hits\": [...]}" });
    expect(validateHits({ hits: Array(501).fill(hit()) }, now)).toEqual({ error: "At most 500 hits per request" });
  });
});
