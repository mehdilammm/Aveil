import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/plugin/latest/route";
import { latestPluginInfo, PLUGIN_RELEASE } from "./plugin-release";

const root = join(__dirname, "..");
const includes = join(root, "wordpress/agentscope-core/includes");
const zip = join(root, "public/downloads", PLUGIN_RELEASE.file);
const hasPhp = !spawnSync("php", ["-v"]).error;
// A throwaway release key for the tests; the real private key lives only in the GitHub Actions secret.
const keys = generateKeyPairSync("ed25519");
const TEST_PUBLIC = keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
const signRelease = (version: string, sha256: string, key = keys.privateKey) => sign(null, Buffer.from(`agentscope-core|${version}|${sha256}`), key).toString("base64");
const signed = (origin: string, extra: Record<string, unknown> = {}) => JSON.stringify({ ...latestPluginInfo(origin), signature: signRelease(PLUGIN_RELEASE.version, PLUGIN_RELEASE.sha256), ...extra });
const harness = (...args: string[]) => {
  const r = spawnSync("php", [join(__dirname, "fixtures/updater-harness.php"), includes, ...args], { encoding: "utf8", env: { ...process.env, AGSC_TEST_RELEASE_KEY: TEST_PUBLIC } });
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

  it("/api/plugin/latest answers with the zip on the app's own address, whatever host was asked", async () => {
    const res = GET();
    const body = await res.json();
    expect(body).toMatchObject({ slug: "agentscope-core", version: PLUGIN_RELEASE.version, sha256: PLUGIN_RELEASE.sha256, download_url: `https://agentscope-peach.vercel.app/downloads/${PLUGIN_RELEASE.file}` });
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
  const good = signed("https://app.test");

  it("accepts only a release signed with the plugin's key", () => {
    expect(harness("parse", good, "app.test")).toMatchObject({ version: PLUGIN_RELEASE.version });
    const unsigned = JSON.stringify(latestPluginInfo("https://app.test"));
    expect(harness("parse", unsigned, "app.test")).toBeNull();
    const otherKey = generateKeyPairSync("ed25519").privateKey;
    expect(harness("parse", signed("https://app.test", { signature: signRelease(PLUGIN_RELEASE.version, PLUGIN_RELEASE.sha256, otherKey) }), "app.test")).toBeNull();
    // A compromised server swapping the zip (new SHA-256) or the version cannot reuse the signature.
    expect(harness("parse", good.replace(PLUGIN_RELEASE.sha256, "f".repeat(64)), "app.test")).toBeNull();
    expect(harness("parse", good.replace(`"version":"${PLUGIN_RELEASE.version}"`, '"version":"9.9.9"'), "app.test")).toBeNull();
  });

  it("accepts the app's answer; refuses another host, http, a bad checksum or a strange path", () => {
    expect(harness("parse", good, "app.test")).toMatchObject({ version: PLUGIN_RELEASE.version, sha256: PLUGIN_RELEASE.sha256 });
    expect(harness("parse", good, "other.test")).toBeNull();
    expect(harness("parse", good.replace("https://app.test", "http://app.test"), "app.test")).toBeNull();
    expect(harness("parse", good.replace(PLUGIN_RELEASE.sha256, "abc"), "app.test")).toBeNull();
    expect(harness("parse", good.replace("/downloads/", "/evil/"), "app.test")).toBeNull();
  });

  it("asks only from WP-Cron (filters never call the network), sends no store data, installs only a zip with the right SHA-256", () => {
    const r = harness("flow", signed("https://agentscope-peach.vercel.app"), zip);
    expect(r).toMatchObject({ requests_before_cron: 0, offered_before_cron: false });
    expect(r).toMatchObject({ update: PLUGIN_RELEASE.version, requests: 1, request_url: "https://agentscope-peach.vercel.app/api/plugin/latest", sent_body: false, installed: true, error: null });
    expect(r.user_agent).toMatch(/^AgentScope-Core\/[0-9.]+$/);
  });

  it("a zip whose SHA-256 does not match is refused", () => {
    // Signed for another SHA-256 than the zip that is downloaded (for example a swapped file on the server).
    const tampered = JSON.stringify({ ...latestPluginInfo("https://agentscope-peach.vercel.app"), sha256: "0".repeat(64), signature: signRelease(PLUGIN_RELEASE.version, "0".repeat(64)) });
    expect(harness("flow", tampered, zip)).toMatchObject({ installed: false, error: "agsc_checksum" });
  });
});
