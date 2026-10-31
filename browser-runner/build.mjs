// Build Output API v3: one function, /api/run, bundled from the app's lib/ (browser flow, guarded proxy and fetcher)
// with esbuild. Chromium and puppeteer-core stay as node_modules next to the bundle.
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const out = ".vercel/output";
const fn = `${out}/functions/api/run.func`;
rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

await build({
  entryPoints: ["src/handler.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: `${fn}/index.mjs`,
  external: ["@sparticuz/chromium", "puppeteer-core"],
  alias: { "server-only": "./src/server-only.js" },
  nodePaths: ["node_modules"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});

execSync("npm prune --omit=dev", { stdio: "inherit" });
cpSync("node_modules", `${fn}/node_modules`, { recursive: true, dereference: true });
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: "module" }));
writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 150, memory: 2048 }, null, 2));
writeFileSync(`${out}/config.json`, JSON.stringify({ version: 3 }, null, 2));
console.log("browser runner built:", fn);
