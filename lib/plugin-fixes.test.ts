import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const hasPhp = !spawnSync("php", ["-v"]).error;
const run = (c: string) => {
  const r = spawnSync("php", [join(root, "lib/fixtures/fixes-harness.php"), c], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout);
};
const src = readFileSync(join(root, "wordpress/agentscope-core/includes/class-agsc-fixes.php"), "utf8");

describe.skipIf(!hasPhp)("plugin 1.6.0 fixes (PHP)", () => {
  it("only signed requests with a fresh, unused nonce are accepted", () => {
    expect(run("auth")).toEqual({ good: true, replay: false, bad_sig: false, old: false, tampered: false });
  });

  it("applies known kinds only; markup in values is stripped; revert removes one fix", () => {
    const r = run("apply");
    expect(r.applied.map((f: { kind: string }) => f.kind)).toEqual(["jsonld", "llms_txt"]);
    expect(r.brand_fallback).toBe("Matha Mirrors");
    expect(r.after_revert.map((f: { kind: string }) => f.kind)).toEqual(["llms_txt"]);
  });

  it("extends the same Product node (same @id, no second Product); an existing brand is kept", () => {
    const r = run("node");
    expect(r.fallback["@id"]).toBe("https://matha.site/product/round-led-mirror/#product");
    expect(r.fallback.brand).toEqual({ "@type": "Brand", name: "Matha Mirrors" });
    expect(r.own_brand.brand.name).toBe("Matha");
    expect(r.kept.brand.name).toBe("X");
    expect(r.encoded.match(/"@type":"Product"/g)).toHaveLength(1);
  });

  it("</script> in data cannot close the JSON-LD script tag", () => {
    const r = run("node");
    expect(r.encoded).not.toContain("</script>");
    expect(r.encoded).not.toContain("<");
    expect(JSON.parse(r.encoded)["@graph"][0].brand.name).toBe("</script><script>alert(1)</script> & co");
  });

  it("robots.txt groups added once; no network and no extra query on page load", () => {
    const r = run("robots");
    expect(r.once).toContain("User-agent: *\nDisallow: /wp-admin/\n\n# AgentScope");
    expect(r.twice_same).toBe(true);
    const pageLoad = src.slice(src.indexOf("// ---- What the fixes do"), src.indexOf("// ---- Settings page"));
    expect(pageLoad).not.toMatch(/wp_remote_|curl_|\$wpdb/);
  });
});
