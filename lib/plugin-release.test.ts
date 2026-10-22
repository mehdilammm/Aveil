import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/plugin/latest/route";
import { latestPluginInfo, PLUGIN_RELEASE } from "./plugin-release";

const root = join(__dirname, "..");
const includes = join(root, "wordpress/agentscope-core/includes");
const zip = join(root, "public/downloads", PLUGIN_RELEASE.file);
const hasPhp = !spawnSync("php", ["-v"]).error;
const harness = (...args: string[]) => {
  const r = spawnSync("php", [join(__dirname, "fixtures/updater-harness.php"), includes, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout);
};

describe("plugin release", () => {
  it("the published SHA-256 is the zip's, and versions agree", () => {
    expect(createHash("sha256").update(readFileSync(zip)).digest("hex")).toBe(PLUGIN_RELEASE.sha256);
    const main = readFileSync(join(root, "wordpress/agentscope-core/agentscope-core.php"), "utf8");
    expect(main).toContain(`Version:           ${PLUGIN_RELEASE.version}`);
    expect(main).toContain(`define('AGSC_VERSION', '${PLUGIN_RELEASE.version}')`);
    expect(readFileSync(join(root, "wordpress/agentscope-core/readme.txt"), "utf8")).toContain(`Stable tag: ${PLUGIN_RELEASE.version}`);
  });

  it("/api/plugin/latest answers with a zip on the host it was asked on", async () => {
    const res = GET(new Request("https://app.test/api/plugin/latest"));
    const body = await res.json();
    expect(body).toMatchObject({ slug: "agentscope-core", version: PLUGIN_RELEASE.version, sha256: PLUGIN_RELEASE.sha256, download_url: `https://app.test/downloads/${PLUGIN_RELEASE.file}` });
    expect(res.headers.get("cache-control")).toContain("max-age=3600");
  });

  it("readme has the WordPress.org headers and an External services section with Terms and Privacy", () => {
    const readme = readFileSync(join(root, "wordpress/agentscope-core/readme.txt"), "utf8");
    for (const h of ["=== AgentScope Core ===", "Contributors:", "Tags:", "Requires at least:", "Tested up to:", "Requires PHP:", "License URI:", "== Description ==", "== Installation ==", "== External services ==", "== Changelog ==", "/terms", "/privacy"]) {
      expect(readme).toContain(h);
    }
  });
});

describe.skipIf(!hasPhp)("plugin update checker (PHP)", () => {
  const good = JSON.stringify(latestPluginInfo("https://app.test"));

  it("accepts the app's answer; refuses another host, http, a bad checksum or a strange path", () => {
    expect(harness("parse", good, "app.test")).toMatchObject({ version: PLUGIN_RELEASE.version, sha256: PLUGIN_RELEASE.sha256 });
    expect(harness("parse", good, "other.test")).toBeNull();
    expect(harness("parse", good.replace("https://app.test", "http://app.test"), "app.test")).toBeNull();
    expect(harness("parse", good.replace(PLUGIN_RELEASE.sha256, "abc"), "app.test")).toBeNull();
    expect(harness("parse", good.replace("/downloads/", "/evil/"), "app.test")).toBeNull();
  });

  it("asks only from WP-Cron (filters never call the network), sends no store data, installs only a zip with the right SHA-256", () => {
    const r = harness("flow", JSON.stringify(latestPluginInfo("https://agentscope-peach.vercel.app")), zip);
    expect(r).toMatchObject({ requests_before_cron: 0, offered_before_cron: false });
    expect(r).toMatchObject({ update: PLUGIN_RELEASE.version, requests: 1, request_url: "https://agentscope-peach.vercel.app/api/plugin/latest", sent_body: false, installed: true, error: null });
    expect(r.user_agent).toMatch(/^AgentScope-Core\/[0-9.]+$/);
  });

  it("a zip whose SHA-256 does not match is refused", () => {
    const tampered = JSON.stringify({ ...latestPluginInfo("https://agentscope-peach.vercel.app"), sha256: "0".repeat(64) });
    expect(harness("flow", tampered, zip)).toMatchObject({ installed: false, error: "agsc_checksum" });
  });
});
