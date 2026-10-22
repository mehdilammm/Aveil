import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askGemini, type AskResult } from "./gemini";
import { GROUNDING_DAILY_LIMIT, GROUNDING_MODEL, GROUNDING_MONTHLY_LIMIT, groundingFlag, type CitationRecord } from "./grounding";

export type GroundedAnswer = { result: AskResult; citations: CitationRecord | null; grounded: boolean; attempted: boolean };

// Every answer records why it has no citations, never silently: "grounding skipped: <reason>".
const skipped = (reason: string): CitationRecord => ({ unavailable: `grounding skipped: ${reason}` });

// One AI Visibility question to Gemini. With grounding on and within the caps: GROUNDING_MODEL with google_search.
// If Google refuses it (free tier, 400, 403, 429, ...), or gives no answer, the reason is kept word for word as
// "Citations unavailable" and the question is asked again without grounding on GEMINI_MODEL, so the answer is not lost.
export async function askVisibilityQuestion(admin: SupabaseClient, prompt: string): Promise<GroundedAnswer> {
  const flag = groundingFlag();
  if (!flag.enabled) return { result: await askGemini(prompt), citations: skipped(`flag off (GEMINI_GROUNDING_ENABLED is ${flag.read})`), grounded: false, attempted: false };
  if (!GROUNDING_MODEL) return { result: await askGemini(prompt), citations: skipped("model not configured (GEMINI_GROUNDING_MODEL is empty)"), grounded: false, attempted: false };

  const { data: reserved, error } = await admin.rpc("grounding_reserve_capped", { p_month_limit: GROUNDING_MONTHLY_LIMIT, p_day_limit: GROUNDING_DAILY_LIMIT });
  if (error || !reserved) {
    return {
      result: await askGemini(prompt),
      citations: skipped(error ? `could not check the grounding limit (${error.message})` : `limit reached (${GROUNDING_DAILY_LIMIT} per day, ${GROUNDING_MONTHLY_LIMIT} per month for the app); asked without Google Search`),
      grounded: false,
      attempted: false,
    };
  }

  const g = await askGemini(prompt, { grounding: true, model: GROUNDING_MODEL });
  if (g.requests > 1) await admin.rpc("grounding_record", { p_n: g.requests - 1 });
  if (g.ok && g.text && !g.blocked) {
    return { result: g, citations: g.grounding ?? { unavailable: `${GROUNDING_MODEL} answered with Google Search on, but returned no sources.` }, grounded: !!g.grounding, attempted: true };
  }
  const reason = !g.ok ? g.error : g.blocked ? `Blocked by Gemini: ${g.blocked}` : `${GROUNDING_MODEL} gave an empty answer`;
  const plain = await askGemini(prompt);
  return {
    // Requests of both calls are counted; the answer is the one without grounding.
    result: { ...plain, requests: plain.requests + g.requests },
    citations: { unavailable: `Google Search grounding failed on ${GROUNDING_MODEL}: ${reason}. Asked again without grounding.` },
    grounded: false,
    attempted: true,
  };
}
