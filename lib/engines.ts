import "server-only";
import { askGemini, GEMINI_MODEL, geminiConfigured, type AskResult } from "./gemini";
import { askMistral, MISTRAL_MODEL, mistralConfigured } from "./mistral";
import {
  combineAnalysis, EXTRACTION_JSON_SCHEMA, EXTRACTION_MAX_TOKENS, EXTRACTION_SCHEMA, extractionPrompt, extractionProblem,
  parseExtraction, type Analysis, type BrandTerms, type EngineId,
} from "./visibility";

export const ENGINE_MODEL: Record<EngineId, string> = { gemini: GEMINI_MODEL, mistral: MISTRAL_MODEL };

export function engineConfigured(id: EngineId): boolean {
  return id === "gemini" ? geminiConfigured() : mistralConfigured();
}

export function askEngine(id: EngineId, prompt: string): Promise<AskResult> {
  return id === "gemini" ? askGemini(prompt) : askMistral(prompt);
}

export type Usage = Record<EngineId, { requests: number; input: number; output: number; waitedMs?: number }>;
export const emptyUsage = (): Usage => ({ gemini: { requests: 0, input: 0, output: 0, waitedMs: 0 }, mistral: { requests: 0, input: 0, output: 0, waitedMs: 0 } });

function count(usage: Usage, id: EngineId, r: AskResult) {
  usage[id].requests += r.requests;
  usage[id].waitedMs = (usage[id].waitedMs ?? 0) + (r.waitedMs ?? 0);
  if (r.ok) {
    usage[id].input += r.inputTokens;
    usage[id].output += r.outputTokens;
  }
}

export type Extracted = { analysis: Analysis & { method: "model" | "failed" }; extractor: EngineId | null; problem: string | null };

// Reads the shop names from an answer. Mistral answers are extracted by Mistral (json_schema); if that fails,
// Gemini extracts them. Gemini answers are extracted by Gemini. The extractor used is returned.
export async function extractNames(engine: EngineId, answer: string, terms: BrandTerms, label: string, usage: Usage): Promise<Extracted> {
  const prompt = extractionPrompt(answer, label, terms.host);
  let problem: string | null = null;
  if (engine === "mistral" && mistralConfigured()) {
    const x = await askMistral(prompt, { jsonSchema: EXTRACTION_JSON_SCHEMA, maxOutputTokens: EXTRACTION_MAX_TOKENS });
    count(usage, "mistral", x);
    const parsed = x.ok ? parseExtraction(x.text) : null;
    if (parsed) return { analysis: combineAnalysis(answer, terms, parsed), extractor: "mistral", problem: null };
    problem = `Mistral extraction: ${extractionProblem(x.ok ? { ok: true, text: x.text, finishReason: x.finishReason } : { ok: false, error: x.error })}`;
  }
  if (geminiConfigured()) {
    const x = await askGemini(prompt, { jsonSchema: EXTRACTION_SCHEMA, maxOutputTokens: EXTRACTION_MAX_TOKENS });
    count(usage, "gemini", x);
    const parsed = x.ok ? parseExtraction(x.text) : null;
    if (parsed) return { analysis: combineAnalysis(answer, terms, parsed), extractor: "gemini", problem: null };
    problem = [problem, `Gemini extraction: ${extractionProblem(x.ok ? { ok: true, text: x.text, finishReason: x.finishReason } : { ok: false, error: x.error })}`].filter(Boolean).join("; ");
  }
  return { analysis: combineAnalysis(answer, terms, null), extractor: null, problem: problem ?? "no extraction engine available" };
}

export { count as countUsage };
