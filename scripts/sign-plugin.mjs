// Signs the plugin release in lib/plugin-release.json: Ed25519 over "agentscope-core|<version>|<sha256>", with the
// private key from PLUGIN_SIGNING_KEY (a GitHub Actions secret; never in Vercel). It first checks that the zip's
// SHA-256 is the published one, and that the signature verifies with the public key embedded in the plugin.
// Run (GitHub Actions): node scripts/sign-plugin.mjs   → writes "signature" when it is missing or stale.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const releasePath = join(root, "lib/plugin-release.json");
const release = JSON.parse(readFileSync(releasePath, "utf8"));
const zip = readFileSync(join(root, "public/downloads", release.file));
if (createHash("sha256").update(zip).digest("hex") !== release.sha256) throw new Error("The zip does not match lib/plugin-release.json");

const updater = readFileSync(join(root, "wordpress/agentscope-core/includes/class-agsc-updater.php"), "utf8");
const pub = /const PUBLIC_KEY\s*=\s*'([A-Za-z0-9+/=]*)'/.exec(updater)?.[1] ?? "";
if (Buffer.from(pub, "base64").length !== 32) throw new Error("AGSC_Updater::PUBLIC_KEY is not set");
const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pub, "base64")]), format: "der", type: "spki" });

export const releaseMessage = (r) => Buffer.from(`agentscope-core|${r.version}|${r.sha256}`);
const message = releaseMessage(release);
if (release.signature && verify(null, message, publicKey, Buffer.from(release.signature, "base64"))) {
  console.log(`already signed: ${release.file}`);
  process.exit(0);
}
const seed = Buffer.from(process.env.PLUGIN_SIGNING_KEY ?? "", "base64");
if (seed.length !== 32) throw new Error("PLUGIN_SIGNING_KEY (32-byte base64 Ed25519 seed) is missing");
const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
const signature = sign(null, message, privateKey);
if (!verify(null, message, publicKey, signature)) throw new Error("PLUGIN_SIGNING_KEY does not match the plugin's public key");
writeFileSync(releasePath, JSON.stringify({ ...release, signature: signature.toString("base64") }, null, 2) + "\n");
console.log(`signed: ${release.file}`);
