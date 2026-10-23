import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateHits } from "./bot-hits";
import { botOfUa } from "./bot-verify";

const root = join(__dirname, "..");
const hasPhp = !spawnSync("php", ["-v"]).error;
const run = (c: string) => {
  const r = spawnSync("php", [join(root, "lib/fixtures/bothits-harness.php"), c], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout);
};
const src = readFileSync(join(root, "wordpress/agentscope-core/includes/class-agsc-bothits.php"), "utf8");

describe.skipIf(!hasPhp)("plugin 1.5.0 bot hits (PHP)", () => {
  it("only AI bot user agents, with the same names as the app; people and other bots are never matched", () => {
    expect(run("match")).toEqual(["ClaudeBot", "GPTBot", null, null, null, "OAI-SearchBot"]);
    const names = [...src.matchAll(/'([A-Za-z-]+)'\s+=>\s+'~/g)].map((m) => m[1]);
    for (const n of names) expect(botOfUa(`Mozilla/5.0 (compatible; ${n}/1.0)`)).toBe(n);
  });

  it("records a bot (path without query string), never a person, and nothing when not connected", () => {
    const r = run("record");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ bot: "ClaudeBot", ip: "216.73.216.10", url_path: "/product/round-led-mirror/", method: "GET", http_status: 200 });
    // The app accepts exactly what the plugin sends.
    const v = validateHits(r.payload, new Date());
    expect("hits" in v && v.hits.length).toBe(1);
    expect("hits" in v && v.skipped).toBe(0);
  });

  it("sends signed batches, deletes rows once accepted, keeps them on failure, never longer than 7 days", () => {
    const r = run("flush");
    expect(r.after_failed).toBe(2); // the 8-day-old row was deleted, the 2 new ones kept for a retry
    expect(r.ok).toBe("Sent 2 bot hits.");
    expect(r.after_ok).toBe(0);
    expect(r.url).toBe("https://app.test/api/ingest/bot-hits");
    expect(r.signature_ok).toBe(true);
  });

  it("no network on page load: record() only inserts; sends happen in WP-Cron", () => {
    const record = src.slice(src.indexOf("public static function record"), src.indexOf("public static function payload"));
    expect(record).not.toMatch(/wp_remote_|curl_|file_get_contents|gethostbyaddr|dns_get_record/);
    expect(src).toContain("add_action(self::CRON, array(__CLASS__, 'flush'))");
    const uninstall = readFileSync(join(root, "wordpress/agentscope-core/uninstall.php"), "utf8");
    expect(uninstall).toMatch(/DROP TABLE IF EXISTS \{\$wpdb->prefix\}agsc_bot_hits/);
  });
});
