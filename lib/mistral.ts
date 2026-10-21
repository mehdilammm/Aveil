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

export function mistralConfigured(): boolean {
  return Boolean(process.env.MISTRAL_API_KEY?.trim());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type AskOptions = { jsonSchema?: object; maxOutputTokens?: number };

export async function askMistral(prompt: string, options: AskOptions = {}): Promise<AskResult> {
  const key = process.env.MISTRAL_API_KEY?.trim();
  if (!key) return { ok: false, error: "MISTRAL_API_KEY is not set", requests: 0 };
  let requests = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    requests++;
    try {
      const res = await fetch(ENDPOINT, {
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
      if ((res.status === 429 || res.status >= 500) && attempt === 0) {
        const wait = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 10) * 1000 : 3000);
        continue;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const b = body as { message?: string; detail?: unknown; error?: { message?: string } } | null;
        const message = b?.message ?? b?.error?.message ?? (typeof b?.detail === "string" ? b.detail : `HTTP ${res.status}`);
        const hint = res.status === 401 ? " (API key not accepted)" : res.status === 429 ? " (free plan rate limit or quota reached)" : "";
        return { ok: false, error: `Mistral API error ${res.status}${hint}: ${String(message).slice(0, 200)}`, requests };
      }
      return { ok: true, ...parseMistralResponse(body), requests };
    } catch (err) {
      if (attempt === 0) {
        await sleep(2000);
        continue;
      }
      return { ok: false, error: err instanceof Error && err.name === "TimeoutError" ? "Mistral did not answer within 30 seconds" : "Request to Mistral failed", requests };
    }
  }
  return { ok: false, error: "Mistral is busy (rate limited). Try again later.", requests };
}
