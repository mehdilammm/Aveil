import "server-only";
import { NotVerifiedError } from "./agent-sim-run";
import { BrowserUnavailableError } from "./browser-sim";
import type { BrowserResult } from "./browser-sim-run";
import { SITE } from "./site";

// The browser test runs in its own function (/api/jobs/browser), the only one that ships Chromium, so the queue's
// tick and every other function stay small. The tick calls it for one claimed job and waits for the result.
// CRON_SECRET authorizes the call; without it, or when that function has no browser, the job waits (BrowserUnavailableError).
export async function runBrowserRemote(jobId: string, fetcher: typeof fetch = fetch): Promise<BrowserResult> {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new BrowserUnavailableError("CRON_SECRET is not set, so the browser function cannot be called.");
  const res = await fetcher(`${SITE.url}/api/jobs/browser`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify({ jobId }),
    signal: AbortSignal.timeout(150_000),
  }).catch((err: unknown) => {
    throw new BrowserUnavailableError(`browser function unreachable: ${err instanceof Error ? err.message : "unknown"}`);
  });
  const body = (await res.json().catch(() => ({}))) as { result?: BrowserResult; error?: string; notVerified?: boolean };
  if (res.ok && body.result) return body.result;
  if (body.notVerified) throw new NotVerifiedError(body.error ?? "Store ownership is not verified.");
  if (res.status === 503 || res.status === 404) throw new BrowserUnavailableError(body.error ?? `browser function answered ${res.status}`);
  throw new Error(body.error ?? `browser function answered ${res.status}`);
}
