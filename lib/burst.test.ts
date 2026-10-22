import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHECKER_CONFIDENCE, splitCheckerRows } from "./traffic";

const includes = join(__dirname, "..", "wordpress", "agentscope-core", "includes");
const hasPhp = !spawnSync("php", ["-v"]).error;

function isBurst(events: [number, string, string][], now: number): boolean {
  const list = JSON.stringify(events.map(([t, source, category]) => ({ t, source, category })));
  const r = spawnSync("php", ["-r", `define('ABSPATH', '/'); require '${includes}/class-agsc-burst.php'; echo AGSC_Burst::is_burst(json_decode($argv[1], true), (int) $argv[2]) ? 'yes' : 'no';`, "--", list, String(now)], { encoding: "utf8" });
  return r.stdout.trim() === "yes";
}

function observe(requests: [number, string, string][]): { labels: string[]; moved: number } {
  const r = spawnSync("php", [join(__dirname, "fixtures", "burst-harness.php"), includes, JSON.stringify(requests)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

describe.skipIf(!hasPhp)("plugin burst detection (HEURISTIC)", () => {
  const t = 1792677240; // 13:54 UTC

  it("3 different AI sources within 60 s is a burst", () => {
    expect(isBurst([[t, "OpenAI", "crawler"], [t + 5, "Anthropic", "crawler"], [t + 9, "Perplexity", "crawler"]], t + 10)).toBe(true);
  });

  it("2 sources, or 3 sources spread over more than 60 s, is not", () => {
    expect(isBurst([[t, "OpenAI", "crawler"], [t + 5, "Anthropic", "crawler"]], t + 10)).toBe(false);
    expect(isBurst([[t, "OpenAI", "crawler"], [t + 30, "Anthropic", "crawler"], [t + 70, "Perplexity", "crawler"]], t + 70)).toBe(false);
  });

  it("5+ requests with 3+ bot names of one company is a burst; 5 hits of one crawler is not", () => {
    const openai: [number, string, string][] = [[t, "OpenAI", "crawler"], [t + 1, "OpenAI", "search-crawler"], [t + 2, "OpenAI", "agent-retrieval"], [t + 3, "OpenAI", "crawler"], [t + 4, "OpenAI", "crawler"]];
    expect(isBurst(openai, t + 5)).toBe(true);
    expect(isBurst(openai.slice(0, 4), t + 5)).toBe(false);
    expect(isBurst([0, 1, 2, 3, 4, 5].map((i) => [t + i, "OpenAI", "crawler"] as [number, string, string]), t + 6)).toBe(false);
  });

  it("the 13:54 case: 14 requests from 3 sources in one minute; the 2 counted before the burst are moved", () => {
    const bots: [string, string][] = [["OpenAI", "crawler"], ["Anthropic", "crawler"], ["Perplexity", "crawler"], ["OpenAI", "search-crawler"], ["Anthropic", "search-crawler"], ["Perplexity", "agent-retrieval"]];
    const requests = Array.from({ length: 14 }, (_, i) => [t + i * 3, ...bots[i % bots.length]] as [number, string, string]);
    const r = observe(requests);
    expect(r.labels.slice(0, 2)).toEqual(["unverified", "unverified"]);
    expect(r.labels.slice(2).every((l) => l === "checker")).toBe(true);
    expect(r.moved).toBe(2);
  });

  it("a lone crawler a few minutes later is counted normally", () => {
    const r = observe([[t, "OpenAI", "crawler"], [t + 300, "Anthropic", "crawler"], [t + 600, "Perplexity", "crawler"]]);
    expect(r).toEqual({ labels: ["unverified", "unverified", "unverified"], moved: 0 });
  });
});

describe("app: checker rows apart", () => {
  it("main numbers leave out likely-checker-tool", () => {
    const rows = [
      { confidence: "unverified-user-agent", hits: 3 },
      { confidence: "unverified-referrer", hits: 2 },
      { confidence: CHECKER_CONFIDENCE, hits: 14 },
    ];
    const { main, checker } = splitCheckerRows(rows);
    expect(main.reduce((n, r) => n + r.hits, 0)).toBe(5);
    expect(checker.reduce((n, r) => n + r.hits, 0)).toBe(14);
  });
});
