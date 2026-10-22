import "server-only";
import { askGemini, geminiConfigured, type AskResult } from "./gemini";
import { parseMistralResponse } from "./visibility";

// Small models for internal tasks only (reading shop names out of an answer, phrasing the topic of the general
// question). They are never asked the visibility questions and never shown as AI search engines.
// Chain: Groq → NVIDIA → Gemini → heuristic (the caller's fallback). Each step: timeout, one retry on 429 with
// Retry-After, then the next step. A reply that is not valid JSON or fails validation also moves to the next step.
//
// Groq (OpenAI-compatible): https://console.groq.com/docs/openai
//   Model: openai/gpt-oss-20b, the replacement Groq names for llama-3.1-8b-instant (shut down on the free plan on
//   2026-08-16): https://console.groq.com/docs/deprecations. Models: https://console.groq.com/docs/models
//   Structured output (json_schema): https://console.groq.com/docs/structured-outputs
//   Free plan limits (per model, shown in the console): https://console.groq.com/docs/rate-limits
// NVIDIA API catalog (build.nvidia.com, OpenAI-compatible): https://docs.api.nvidia.com/nim/reference/llm-apis
//   Model: meta/llama-3.1-8b-instruct: https://docs.api.nvidia.com/nim/reference/meta-llama-3_1-8b
//   The key is for testing use only, so NVIDIA is only a fallback; set NVIDIA_ENABLED=false once paying customers come.
// GROQ_ENABLED / NVIDIA_ENABLED (default true) turn each one off without a code change.

export type TaskModelId = "groq" | "nvidia";
export type TaskBy = TaskModelId | "gemini";

type Provider = { id: TaskModelId; name: string; endpoint: string; model: string; keyEnv: string; enabledEnv: string; jsonSchemaMode: boolean };

export const TASK_PROVIDERS: Record<TaskModelId, Provider> = {
  groq: {
    id: "groq",
    name: "Groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b",
    keyEnv: "GROQ_API_KEY",
    enabledEnv: "GROQ_ENABLED",
    jsonSchemaMode: true,
  },
  nvidia: {
    id: "nvidia",
    name: "NVIDIA",
    endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
    model: process.env.NVIDIA_MODEL?.trim() || "meta/llama-3.1-8b-instruct",
    keyEnv: "NVIDIA_API_KEY",
    enabledEnv: "NVIDIA_ENABLED",
    // Schema support differs per hosted model; the prompt asks for JSON and the reply is validated instead.
    jsonSchemaMode: false,
  },
};

const TIMEOUT_MS = 20_000;
const RETRY_DEFAULT_MS = 2000;
const RETRY_MAX_MS = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry-After in seconds or as a date; 2 s when missing; at most 10 s.
export function retryAfterMs(header: string | null, now = Date.now()): number {
  if (!header) return RETRY_DEFAULT_MS;
  const seconds = Number(header.trim());
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, RETRY_MAX_MS) : RETRY_DEFAULT_MS;
}

// On unless the flag is "false" (or 0/off/no), and only with a key.
export function taskModelEnabled(id: TaskModelId): boolean {
  const p = TASK_PROVIDERS[id];
  const flag = process.env[p.enabledEnv]?.trim().toLowerCase();
  if (flag && ["false", "0", "off", "no"].includes(flag)) return false;
  return Boolean(process.env[p.keyEnv]?.trim());
}

type AskOptions = { jsonSchema?: object; maxOutputTokens?: number };

export async function askTaskModel(id: TaskModelId, prompt: string, options: AskOptions = {}): Promise<AskResult> {
  const p = TASK_PROVIDERS[id];
  const key = process.env[p.keyEnv]?.trim();
  if (!key) return { ok: false, error: `${p.keyEnv} is not set`, requests: 0 };
  let requests = 0;
  let waitedMs = 0;
  const reasoning = id === "groq" && p.model.startsWith("openai/gpt-oss");
  for (let attempt = 0; attempt < 2; attempt++) {
    requests++;
    let res: Response;
    try {
      res = await fetch(p.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, Accept: "application/json" },
        body: JSON.stringify({
          model: p.model,
          messages: [{ role: "user", content: prompt }],
          // gpt-oss reasons before it answers, and the reasoning counts in max_tokens.
          max_tokens: Math.max(options.maxOutputTokens ?? 1024, reasoning ? 1024 : 0),
          temperature: 0,
          ...(reasoning ? { reasoning_effort: "low" } : {}),
          ...(options.jsonSchema && p.jsonSchemaMode
            ? { response_format: { type: "json_schema", json_schema: { name: "result", schema: options.jsonSchema, strict: true } } }
            : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error && err.name === "TimeoutError" ? `${p.name} did not answer within ${TIMEOUT_MS / 1000} seconds` : `Request to ${p.name} failed`, requests, waitedMs };
    }
    if (res.status === 429 && attempt === 0) {
      await res.body?.cancel().catch(() => undefined);
      const wait = retryAfterMs(res.headers.get("retry-after"));
      waitedMs += wait;
      await sleep(wait);
      continue;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const b = body as { error?: { message?: string } | string; message?: string; detail?: unknown } | null;
      const message = (typeof b?.error === "object" ? b.error?.message : b?.error) ?? b?.message ?? (typeof b?.detail === "string" ? b.detail : `HTTP ${res.status}`);
      return { ok: false, error: `${p.name} API error ${res.status}: ${String(message).slice(0, 200)}`, requests, waitedMs };
    }
    return { ok: true, ...parseMistralResponse(body), requests, waitedMs };
  }
  return { ok: false, error: `${p.name} is rate limited`, requests, waitedMs };
}

export type TaskUse = { requests: number; input: number; output: number };
export type TaskAttempt = { by: TaskBy; requests: number; input: number; output: number; problem: string | null };
export type TaskResult<T> = { value: T | null; by: TaskBy | null; attempts: TaskAttempt[] };

export type TaskSpec<T> = {
  prompt: string;
  // Standard JSON Schema (Groq json_schema) and Gemini's schema; without them the reply is plain text.
  jsonSchema?: object;
  geminiSchema?: object;
  maxOutputTokens?: number;
  validate: (text: string) => T | null;
  // Called before the Gemini step (for example to reserve the daily Gemini budget); false skips Gemini.
  allowGemini?: () => Promise<boolean>;
};

// Adds the expected JSON shape to the prompt for models that do not enforce a schema.
function withSchemaHint(prompt: string, schema: object | undefined): string {
  return schema ? `${prompt}\n\nAnswer with one JSON object only, no other text, matching this JSON Schema:\n${JSON.stringify(schema)}` : prompt;
}

export async function runTask<T>(spec: TaskSpec<T>): Promise<TaskResult<T>> {
  const attempts: TaskAttempt[] = [];
  const tryOne = async (by: TaskBy, ask: () => Promise<AskResult>): Promise<T | null> => {
    const r = await ask();
    const value = r.ok && r.text ? spec.validate(r.text) : null;
    attempts.push({
      by,
      requests: r.requests,
      input: r.ok ? r.inputTokens : 0,
      output: r.ok ? r.outputTokens : 0,
      problem: value !== null ? null : !r.ok ? r.error : !r.text ? `empty reply${r.finishReason ? ` (finish reason ${r.finishReason})` : ""}` : "reply did not pass validation",
    });
    return value;
  };

  for (const id of ["groq", "nvidia"] as const) {
    if (!taskModelEnabled(id)) continue;
    const schemaInPrompt = !TASK_PROVIDERS[id].jsonSchemaMode;
    const prompt = schemaInPrompt ? withSchemaHint(spec.prompt, spec.jsonSchema) : spec.prompt;
    const v = await tryOne(id, () => askTaskModel(id, prompt, { jsonSchema: spec.jsonSchema, maxOutputTokens: spec.maxOutputTokens }));
    if (v !== null) return { value: v, by: id, attempts };
  }
  if (geminiConfigured() && (!spec.allowGemini || (await spec.allowGemini()))) {
    const v = await tryOne("gemini", () => askGemini(spec.prompt, { jsonSchema: spec.geminiSchema, maxOutputTokens: spec.maxOutputTokens }));
    if (v !== null) return { value: v, by: "gemini", attempts };
  }
  return { value: null, by: null, attempts };
}

export function attemptsText(attempts: TaskAttempt[]): string | null {
  const failed = attempts.filter((a) => a.problem);
  return failed.length ? failed.map((a) => `${a.by}: ${a.problem}`).join("; ") : null;
}
