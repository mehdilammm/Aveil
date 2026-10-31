// The latest agentscope-core release (written by scripts/build-plugin.mjs together with the zip in public/downloads).
import release from "./plugin-release.json";

export const PLUGIN_RELEASE = release as {
  version: string;
  file: string;
  sha256: string;
  changelog: string[];
  requires: string;
  requires_php: string;
  tested: string;
  signature?: string; // Ed25519, added by .github/workflows/sign-plugin.yml (scripts/sign-plugin.mjs)
};

export const pluginDownloadPath = () => `/downloads/${PLUGIN_RELEASE.file}`;

// What /api/plugin/latest returns. The zip is on the same host the plugin asked (the plugin checks that), and the
// plugin (1.9.0+) installs it only when the signature verifies with its embedded public key.
export function latestPluginInfo(origin: string) {
  const r = PLUGIN_RELEASE;
  return {
    name: "AgentScope Core",
    slug: "agentscope-core",
    version: r.version,
    download_url: `${origin}${pluginDownloadPath()}`,
    sha256: r.sha256,
    ...(r.signature ? { signature: r.signature } : {}),
    changelog: r.changelog,
    requires: r.requires,
    requires_php: r.requires_php,
    tested: r.tested,
  };
}
