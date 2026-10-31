import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NotVerifiedError } from "./agent-sim-run";
import type { BrowserResult } from "./browser-launch";
import { BrowserUnavailableError } from "./browser-sim";
import { signRunnerRequest, type RunnerPayload } from "./browser-signing";
import { checkHeaderValue } from "./check-header";
import { isOwnershipVerified } from "./ownership-store";

// The browser test runs in a separate Vercel project (browser-runner/, BROWSER_RUNNER_URL) that holds no secret but
// BROWSER_RUNNER_SECRET: no database key, no AI keys, no store token. The app checks ownership, signs the
// X-AgentScope-Check value (valid 10 minutes), sends the job and saves the result. Without the runner the job waits.
export async function runBrowserRemote(admin: SupabaseClient, store: { id: string; url: string }, jobId: string, fetcher: typeof fetch = fetch): Promise<BrowserResult> {
  const url = process.env.BROWSER_RUNNER_URL;
  const secret = process.env.BROWSER_RUNNER_SECRET;
  if (!url || !secret) throw new BrowserUnavailableError("The browser runner is not configured (BROWSER_RUNNER_URL, BROWSER_RUNNER_SECRET).");
  if (!(await isOwnershipVerified(admin, store.id))) throw new NotVerifiedError("Store ownership is not verified, so the agent purchase test does not run.");
  const { data: connector } = await admin.rpc("get_traffic_connector_secret", { p_store_id: store.id }).maybeSingle<{ token: string }>();
  const payload: RunnerPayload = { storeUrl: store.url, checkValue: checkHeaderValue(connector?.token ?? null), jobId, nonce: randomBytes(16).toString("hex") };
  const body = JSON.stringify(payload);
  const res = await fetcher(`${url.replace(/\/+$/, "")}/api/run`, {
    method: "POST",
    headers: { "content-type": "application/json", ...signRunnerRequest(secret, body) },
    body,
    signal: AbortSignal.timeout(150_000),
  }).catch((err: unknown) => {
    throw new BrowserUnavailableError(`browser runner unreachable: ${err instanceof Error ? err.message : "unknown"}`);
  });
  const out = (await res.json().catch(() => ({}))) as { result?: BrowserResult; error?: string };
  if (res.ok && out.result) return out.result;
  if (res.status === 503 || res.status === 404) throw new BrowserUnavailableError(out.error ?? `browser runner answered ${res.status}`);
  throw new Error(out.error ?? `browser runner answered ${res.status}`);
}
