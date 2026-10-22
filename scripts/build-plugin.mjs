// Builds public/downloads/agentscope-core-<version>.zip from wordpress/agentscope-core and writes its SHA-256 to
// lib/plugin-release.json, which /api/plugin/latest serves. Run: node scripts/build-plugin.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const main = readFileSync(join(root, "wordpress/agentscope-core/agentscope-core.php"), "utf8");
const version = /\* Version:\s+([0-9.]+)/.exec(main)?.[1];
if (!version) throw new Error("No Version header in agentscope-core.php");
const readme = readFileSync(join(root, "wordpress/agentscope-core/readme.txt"), "utf8");
const stable = /Stable tag:\s*([0-9.]+)/.exec(readme)?.[1];
if (stable !== version) throw new Error(`readme Stable tag ${stable} does not match Version ${version}`);
const section = readme.split(`= ${version} =`)[1]?.split(/\n= |\n== /)[0] ?? "";
const changelog = section.split("\n").map((l) => l.replace(/^\*\s*/, "").trim()).filter(Boolean);
const field = (name) => new RegExp(`^${name}:\\s*(.+)$`, "m").exec(readme)?.[1].trim() ?? "";

const file = `agentscope-core-${version}.zip`;
const out = join(root, "public/downloads", file);
rmSync(out, { force: true });
execFileSync("zip", ["-rqX", out, "agentscope-core"], { cwd: join(root, "wordpress") });
const sha256 = createHash("sha256").update(readFileSync(out)).digest("hex");
const release = { version, file, sha256, changelog, requires: field("Requires at least"), requires_php: field("Requires PHP"), tested: field("Tested up to") };
writeFileSync(join(root, "lib/plugin-release.json"), JSON.stringify(release, null, 2) + "\n");
console.log(`${file} ${sha256}`);
