import "server-only";
import { parseGeminiResponse, type EngineAnswer } from "./visibility";

// Gemini Developer API, generateContent. Model docs: https://ai.google.dev/gemini-api/docs/models
// Default: Gemini 3.5 Flash-Lite, the low-cost current model. Pricing: https://ai.google.dev/gemini-api/docs/pricing
// Grounding with Google Search is NOT enabled: it is not in the free tier for this model and costs extra on paid tiers.
export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 25_000;
const MAX_OUTPUT_TOKENS = 1024;

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type AskResult = ({ ok: true } & EngineAnswer & { requests: number }) | { ok: false; error: string; requests: number };

type AskOptions = { jsonSchema?: object; maxOutputTokens?: number };

// Sends one message as a plain user turn. Retries once on 429 or 5xx.
// With jsonSchema, asks for structured output (responseMimeType application/json + responseSchema).
export async function askGemini(prompt: string, options: AskOptions = {}): Promise<AskResult> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return { ok: false, error: "GEMINI_API_KEY is not set", requests: 0 };
  let requests = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    requests++;
    try {
      const res = await fetch(`${ENDPOINT}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: options.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
            ...(options.jsonSchema ? { responseMimeType: "application/json", responseSchema: options.jsonSchema, temperature: 0 } : {}),
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if ((res.status === 429 || res.status >= 500) && attempt === 0) {
        const wait = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 10) * 1000 : 4000);
        continue;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const message = (body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`;
        // Never echo anything that could contain the key.
        return { ok: false, error: `Gemini API error ${res.status}: ${message.replace(/key=[^\s&]+/gi, "key=…").slice(0, 300)}`, requests };
      }
      return { ok: true, ...parseGeminiResponse(body), requests };
    } catch (err) {
      if (attempt === 0) {
        await sleep(2000);
        continue;
      }
      return { ok: false, error: err instanceof Error && err.name === "TimeoutError" ? "Gemini did not answer within 25 seconds" : "Request to Gemini failed", requests };
    }
  }
  return { ok: false, error: "Gemini is busy (rate limited). Try again later.", requests };
}
