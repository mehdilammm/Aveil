import { createHmac, timingSafeEqual } from "node:crypto";

// Requests from the app to the browser runner (browser-runner/): HMAC-SHA256 of "<timestamp>.<body>" with the one
// secret both projects share (BROWSER_RUNNER_SECRET). The body carries a random nonce; a request older or newer than
// MAX_SKEW_SECONDS is refused.
export const MAX_SKEW_SECONDS = 300;
export const SIGNATURE_HEADER = "x-runner-signature";
export const TIMESTAMP_HEADER = "x-runner-timestamp";

export const runnerSignature = (secret: string, timestamp: string, body: string) => `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

export function signRunnerRequest(secret: string, body: string, nowSeconds = Math.floor(Date.now() / 1000)): Record<string, string> {
  const timestamp = String(nowSeconds);
  return { [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: runnerSignature(secret, timestamp, body) };
}

export function verifyRunnerRequest(secret: string | undefined, timestamp: string | null, signature: string | null, body: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!secret || secret.length < 32 || !timestamp || !signature || !/^\d{9,11}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  const a = Buffer.from(signature);
  const b = Buffer.from(runnerSignature(secret, timestamp, body));
  return a.length === b.length && timingSafeEqual(a, b);
}

// What the app sends: the store address, the X-AgentScope-Check value it signed (never the store's token), the job.
export type RunnerPayload = { storeUrl: string; checkValue: string; jobId: string; nonce: string };

export function parseRunnerPayload(body: string): RunnerPayload | null {
  try {
    const p = JSON.parse(body) as Partial<RunnerPayload>;
    if (typeof p.storeUrl !== "string" || typeof p.checkValue !== "string" || typeof p.jobId !== "string" || typeof p.nonce !== "string") return null;
    const u = new URL(p.storeUrl);
    if (u.protocol !== "https:" || p.checkValue.length > 200 || p.jobId.length > 64 || p.nonce.length > 64) return null;
    return { storeUrl: u.origin, checkValue: p.checkValue, jobId: p.jobId, nonce: p.nonce };
  } catch {
    return null;
  }
}
