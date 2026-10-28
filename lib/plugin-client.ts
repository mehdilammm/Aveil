import "server-only";
import { randomBytes, createHmac } from "node:crypto";
import { BlockedUrlError, guardedFetch } from "./safe-fetch";

export type PluginFix = { id: string; kind: "jsonld" | "llms_txt" | "robots" | "feed" | "org" | "website" | "breadcrumbs" | "shipping" | "variants" | "returns"; target?: number; payload: Record<string, unknown> };
export type PluginAnswer = {
  plugin_version: string;
  done: { id: string }[];
  applied: { id: string; kind: string; target: number | null }[];
  environment: { robots_file: boolean; llms_file: boolean; woocommerce: boolean };
  // 1.8.0: the stored product feed (G1), null when none.
  feed?: { updated_at: number; products: number; bytes: number; urls: { jsonl: string; metadata: string; csv: string } } | null;
  // 1.8.1: fixes the site's admin removed in WordPress (never put back by the app).
  removed?: { id: string; kind: string; at: number }[];
};

// Signature the plugin checks (class-agsc-fixes.php): HMAC-SHA256(token, "<timestamp>.<nonce>.<body>").
export function signFixRequest(token: string, body: string, timestamp: string, nonce: string): string {
  return `sha256=${createHmac("sha256", token).update(`${timestamp}.${nonce}.${body}`).digest("hex")}`;
}

// One signed call to the store's plugin (1.6.0+). Throws with the reason when the plugin cannot be reached.
export async function callPlugin(storeUrl: string, token: string, payload: { action: "apply" | "revert" | "status"; fixes?: PluginFix[]; ids?: string[] }): Promise<PluginAnswer> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString("hex");
  let res;
  try {
    res = await guardedFetch(new URL(`${storeUrl}/wp-json/agentscope-core/v1/fixes`), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AgentScope-Timestamp": timestamp, "X-AgentScope-Nonce": nonce, "X-AgentScope-Signature": signFixRequest(token, body, timestamp, nonce) },
      body,
      timeoutMs: 20_000,
    });
  } catch (err) {
    throw new Error(err instanceof BlockedUrlError ? err.message : "The store's plugin could not be reached.");
  }
  if (res.status === 404) throw new Error("The AgentScope Core plugin 1.6.0 or later is needed on the store (fixes endpoint not found).");
  if (res.status === 401 || res.status === 403) throw new Error("The plugin refused the request: reconnect it to the app (connection token).");
  if (!res.ok) throw new Error(`The plugin answered HTTP ${res.status}.`);
  return (await res.json()) as PluginAnswer;
}
