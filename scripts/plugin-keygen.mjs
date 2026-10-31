// One time, on your own computer (never on the server): creates the Ed25519 key pair that signs plugin releases.
// Run: node scripts/plugin-keygen.mjs
// - PLUGIN_SIGNING_KEY (private, base64): add it as a GitHub Actions secret of the repository, then delete it here.
// - Public key (base64): goes into AGSC_Updater::PUBLIC_KEY in the plugin (it is public, safe to share).
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("base64");
const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
console.log(`PLUGIN_SIGNING_KEY (private, GitHub secret only):\n${seed}\n`);
console.log(`Public key (for the plugin):\n${pub}`);
