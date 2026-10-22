import "server-only";
import type { AskResult } from "./gemini";
import { parseMistralResponse } from "./visibility";

// Mistral chat completions API. Docs: https://docs.mistral.ai/api (chat completions) and
// https://docs.mistral.ai/capabilities/structured_output/custom (response_format json_schema).
// Default model: Mistral Medium (mistral-medium-latest), the model family behind Le Chat's default answers;
// override with MISTRAL_MODEL. Model list: https://docs.mistral.ai/getting-started/models/compare
// The free plan has low rate limits (shown on the console's Limits page), so calls are made one at a time
// with one retry on 429.
export const MISTRAL_MODEL = process.env.MISTRAL_MODEL?.trim() || "mistral-medium-latest";
const ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
const TIMEOUT_MS = 30_000;
const MAX_TOKENS = 1024;

// Off unless MISTRAL_ENABLED=true: the free plan does not activate API keys ("Upgrade to activate your API keys").
export function mistralEnabled(): boolean {
  return process.env.MISTRAL_ENABLED?.trim().toLowerCase() === "true";
}

export const MISTRAL_OFF_REASON = "Not connected: requires a paid Mistral plan";

export function mistralConfigured(): boolean {
  return mistralEnabled() && Boolean(process.env.MISTRAL_API_KEY?.trim());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type AskOptions = { jsonSchema?: object; maxOutputTokens?: number };

// All Mistral calls of this server instance go through one queue: one request at a time, at least
// MISTRAL_GAP_MS between the end of one and the start of the next. (Separate serverless instances each have
// their own queue; the free plan's limit is per key, so a 429 is still handled below.)
export const MISTRAL_GAP_MS = 1200;
const RETRY_DEFAULT_MS = 2000;
const RETRY_MAX_MS = 10_000;
let queue: Promise<unknown> = Promise.resolve();
let lastEnd = 0;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

// Retry-After in seconds or as a date; 2 s when missing; at most 10 s.
export function mistralRetryWaitMs(header: string | null, now = Date.now()): number {
  if (!header) return RETRY_DEFAULT_MS;
  const seconds = Number(header.trim());
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, RETRY_MAX_MS) : RETRY_DEFAULT_MS;
}

export function askMistral(prompt: string, options: AskOptions = {}): Promise<AskResult> {
  return enqueue(() => callMistral(prompt, options));
}

async function callMistral(prompt: string, options: AskOptions): Promise<AskResult> {
  if (!mistralEnabled()) return { ok: false, error: MISTRAL_OFF_REASON, requests: 0 };
  const key = process.env.MISTRAL_API_KEY?.trim();
  if (!key) return { ok: false, error: "MISTRAL_API_KEY is not set", requests: 0 };
  let requests = 0;
  let waitedMs = 0;
  const pause = async (ms: number) => {
    if (ms <= 0) return;
    waitedMs += ms;
    await sleep(ms);
  };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await pause(lastEnd + MISTRAL_GAP_MS - Date.now());
      requests++;
      let res: Response;
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, Accept: "application/json" },
          body: JSON.stringify({
            model: MISTRAL_MODEL,
            messages: [{ role: "user", content: prompt }],
            max_tokens: options.maxOutputTokens ?? MAX_TOKENS,
            ...(options.jsonSchema
              ? { temperature: 0, response_format: { type: "json_schema", json_schema: { name: "extraction", schema: options.jsonSchema, strict: true } } }
              : {}),
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        });
      } catch (err) {
        lastEnd = Date.now();
        if (attempt === 0) {
          await pause(RETRY_DEFAULT_MS);
          continue;
        }
        return { ok: false, error: err instanceof Error && err.name === "TimeoutError" ? "Mistral did not answer within 30 seconds" : "Request to Mistral failed", requests, waitedMs };
      }
      lastEnd = Date.now();
      if ((res.status === 429 || res.status >= 500) && attempt === 0) {
        await res.body?.cancel().catch(() => undefined);
        await pause(mistralRetryWaitMs(res.headers.get("retry-after")));
        continue;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const b = body as { message?: string; detail?: unknown; error?: { message?: string } } | null;
        const message = b?.message ?? b?.error?.message ?? (typeof b?.detail === "string" ? b.detail : `HTTP ${res.status}`);
        const hint = res.status === 401 ? " (API key not accepted)" : res.status === 429 ? " (free plan rate limit or quota reached)" : "";
        const waited = waitedMs ? ` after waiting ${(waitedMs / 1000).toFixed(1)} s` : "";
        return { ok: false, error: `Mistral API error ${res.status}${hint}${waited}: ${String(message).slice(0, 200)}`, requests, waitedMs };
      }
      return { ok: true, ...parseMistralResponse(body), requests, waitedMs };
    }
    return { ok: false, error: "Mistral is busy (rate limited). Try again later.", requests, waitedMs };
  } finally {
    lastEnd = Date.now();
  }
}
