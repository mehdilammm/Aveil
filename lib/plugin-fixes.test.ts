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

describe.skipIf(!hasPhp)("plugin 1.8.0 product feed (PHP, G1)", async () => {
  const { buildFeed } = await import("./feed-build");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const feed = buildFeed({
    feedId: "agentscope-c2ab0cfe", storeUrl: "https://matha.site", siteName: "Matha Mirrors", currency: "MAD", country: "MA", variations: {}, categories: [], links: [], now: new Date("2026-10-28T09:00:00Z"),
    products: [{ id: 174, name: "Round LED Mirror", type: "simple", status: "publish", permalink: "https://matha.site/product/round-led-mirror/", description: "<p>Round mirror with LED lighting.</p>", price: "800", regular_price: "800", sale_price: "", stock_status: "instock", images: [{ src: "https://matha.site/m.png", alt: "Round LED mirror" }], brands: [{ id: 30, name: "Matha Mirrors" }] }],
  });
  const payload = { metadata: JSON.stringify(feed.metadata), jsonl: feed.jsonl, csv: feed.csv };
  const file = join(mkdtempSync(join(tmpdir(), "agsc-feed-")), "payload.json");
  writeFileSync(file, JSON.stringify(payload));
  const r = (() => {
    const out = spawnSync("php", [join(root, "lib/fixtures/fixes-harness.php"), "feed", file], { encoding: "utf8" });
    if (out.status !== 0) throw new Error(out.stderr || out.stdout);
    return JSON.parse(out.stdout);
  })();

  it("stores the feed in its own option (not autoloaded); the fix record holds counts only", () => {
    expect(r.done).toEqual(["3b0c7c3e-2f4a-4b8e-9a51-1d2e3f4a5b6c"]);
    expect(r.record).toMatchObject({ kind: "feed", products: 1, bytes: payload.metadata.length + payload.jsonl.length + payload.csv.length });
    expect(r.record.data).toBeUndefined();
    expect(r.autoload).toBe(false);
    expect(r.status).toMatchObject({ products: 1, urls: { jsonl: "https://matha.site/agentscope-feed/products.jsonl", metadata: "https://matha.site/agentscope-feed/metadata.json", csv: "https://matha.site/agentscope-feed.csv" } });
  });

  it("serves the three files with their content types, byte for byte; other paths are not ours", () => {
    expect(r.served.jsonl).toEqual(["application/jsonl; charset=utf-8", payload.jsonl]);
    expect(r.served.metadata).toEqual(["application/json; charset=utf-8", payload.metadata]);
    expect(r.served.csv).toEqual(["text/csv; charset=utf-8", payload.csv]);
    expect(r.served.other).toBeNull();
    expect(r.subdir).toBe("/agentscope-feed.csv");
    expect(r.root).toBe("/agentscope-feed.csv");
  });

  it("refuses malformed or oversized feeds; one feed per store; undo removes the stored files", () => {
    expect(r.rejected).toEqual({ bad_line: true, no_variants: true, csv: true, metadata: true, too_big: true });
    expect(r.feeds_after_second).toEqual(["4b0c7c3e-2f4a-4b8e-9a51-1d2e3f4a5b6c"]);
    expect(r.after_revert).toEqual({ fixes: [], data: null });
  });
});

describe.skipIf(!hasPhp)("plugin 1.8.1: fixes removed in WordPress admin (PHP)", () => {
  it("a removal is remembered (id, kind, time) and listed in the status answer; applying the same id again forgets it", () => {
    expect(run("removed")).toEqual({
      redirect: "redirect",
      applied: ["2ee73133-639c-4a9a-95bb-8bddb1bd2563"],
      removed: [["006598d5-7131-47d7-a151-f2f26582257a", "org", true]],
      autoload: false,
      removed_after_apply: [],
    });
  });
});
