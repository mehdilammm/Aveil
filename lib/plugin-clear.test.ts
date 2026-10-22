import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const includes = join(__dirname, "..", "wordpress", "agentscope-core", "includes");
const hasPhp = !spawnSync("php", ["-v"]).error;

function validDay(day: string, today: string): boolean {
  const r = spawnSync("php", ["-r", `define('ABSPATH', '/'); require '${includes}/class-agsc-traffic.php'; echo AGSC_Traffic::valid_day($argv[1], $argv[2]) ? 'yes' : 'no';`, "--", day, today], { encoding: "utf8" });
  return r.stdout.trim() === "yes";
}

describe.skipIf(!hasPhp)("plugin 1.2.1: clear one chosen day", () => {
  it("accepts a real day that is today or earlier", () => {
    expect(validDay("2026-10-22", "2026-10-22")).toBe(true);
    expect(validDay("2026-10-01", "2026-10-22")).toBe(true);
  });
  it("refuses future days, impossible dates and other text", () => {
    expect(validDay("2026-10-23", "2026-10-22")).toBe(false);
    expect(validDay("2026-02-30", "2026-10-22")).toBe(false);
    expect(validDay("2026-10-2", "2026-10-22")).toBe(false);
    expect(validDay("2026-10-01' OR 1=1", "2026-10-22")).toBe(false);
  });
});
