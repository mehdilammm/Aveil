import "server-only";
import { askGemini, GEMINI_MODEL, geminiConfigured, type AskResult } from "./gemini";
import { askMistral, MISTRAL_MODEL, mistralConfigured } from "./mistral";
import { parseProfile, profilePrompt, PROFILE_GEMINI_SCHEMA, PROFILE_JSON_SCHEMA, type AnswerProfile } from "./profile";
import { attemptsText, runTask, type TaskAttempt, type TaskBy } from "./task-models";
import {
  combineAnalysis, EXTRACTION_JSON_SCHEMA, EXTRACTION_MAX_TOKENS, EXTRACTION_SCHEMA, extractionPrompt,
  parseExtraction, type Analysis, type BrandTerms, type EngineId,
} from "./visibility";

export const ENGINE_MODEL: Record<EngineId, string> = { gemini: GEMINI_MODEL, mistral: MISTRAL_MODEL };

export function engineConfigured(id: EngineId): boolean {
  return id === "gemini" ? geminiConfigured() : mistralConfigured();
}

export function askEngine(id: EngineId, prompt: string): Promise<AskResult> {
  return id === "gemini" ? askGemini(prompt) : askMistral(prompt);
}

// Requests and tokens per model: the visibility engines and the internal task models (groq, nvidia).
export type UsageKey = EngineId | "groq" | "nvidia";
export const USAGE_KEYS: UsageKey[] = ["gemini", "mistral", "groq", "nvidia"];
export type Usage = Record<UsageKey, { requests: number; input: number; output: number; waitedMs?: number }>;
export const emptyUsage = (): Usage => ({
  gemini: { requests: 0, input: 0, output: 0, waitedMs: 0 },
  mistral: { requests: 0, input: 0, output: 0, waitedMs: 0 },
  groq: { requests: 0, input: 0, output: 0, waitedMs: 0 },
  nvidia: { requests: 0, input: 0, output: 0, waitedMs: 0 },
});

function count(usage: Usage, id: UsageKey, r: AskResult) {
  usage[id].requests += r.requests;
  usage[id].waitedMs = (usage[id].waitedMs ?? 0) + (r.waitedMs ?? 0);
  if (r.ok) {
    usage[id].input += r.inputTokens;
    usage[id].output += r.outputTokens;
  }
}

export function countAttempts(usage: Usage, attempts: TaskAttempt[]) {
  for (const a of attempts) {
    usage[a.by].requests += a.requests;
    usage[a.by].input += a.input;
    usage[a.by].output += a.output;
  }
}

export type Extracted = { analysis: Analysis & { method: "model" | "failed" }; extractor: TaskBy | null; problem: string | null; attempts: TaskAttempt[] };

// Reads the shop names from an answer with the internal task chain: Groq → NVIDIA → Gemini → none (the text match
// still decides "mentioned"; no names are shown). The extractor used and every attempt are returned.
export async function extractNames(answer: string, terms: BrandTerms, label: string, usage: Usage, allowGemini?: () => Promise<boolean>): Promise<Extracted> {
  const t = await runTask({
    prompt: extractionPrompt(answer, label, terms.host),
    jsonSchema: EXTRACTION_JSON_SCHEMA,
    geminiSchema: EXTRACTION_SCHEMA,
    maxOutputTokens: EXTRACTION_MAX_TOKENS,
    validate: parseExtraction,
    allowGemini,
  });
  countAttempts(usage, t.attempts);
  return {
    analysis: combineAnalysis(answer, terms, t.value),
    extractor: t.by,
    problem: t.value ? null : attemptsText(t.attempts) ?? "no extraction model available",
    attempts: t.attempts,
  };
}

export type Profiled = { profile: AnswerProfile | null; by: TaskBy | null; problem: string | null; attempts: TaskAttempt[] };

// Sentiment, description and features of the store and of each named competitor, from one answer (task chain).
export async function profileAnswer(answer: string, terms: BrandTerms, label: string, mentioned: boolean, competitors: string[], usage: Usage, allowGemini?: () => Promise<boolean>): Promise<Profiled> {
  const t = await runTask({
    prompt: profilePrompt(answer, label, terms.host, competitors),
    jsonSchema: PROFILE_JSON_SCHEMA,
    geminiSchema: PROFILE_GEMINI_SCHEMA,
    maxOutputTokens: EXTRACTION_MAX_TOKENS,
    validate: (text) => parseProfile(text, answer, mentioned, competitors),
    allowGemini,
  });
  countAttempts(usage, t.attempts);
  return { profile: t.value, by: t.by, problem: t.value ? null : attemptsText(t.attempts) ?? "no model available", attempts: t.attempts };
}

export { count as countUsage };
