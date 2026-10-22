import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askGemini, type AskResult } from "./gemini";
import { GROUNDING_DAILY_LIMIT, GROUNDING_MODEL, GROUNDING_MONTHLY_LIMIT, groundingEnabled, type CitationRecord } from "./grounding";

export type GroundedAnswer = { result: AskResult; citations: CitationRecord | null; grounded: boolean; attempted: boolean };

// One AI Visibility question to Gemini. With grounding on and within the caps: GROUNDING_MODEL with google_search.
// If Google refuses it (free tier, 400, 403, 429, ...), or gives no answer, the reason is kept word for word as
// "Citations unavailable" and the question is asked again without grounding on GEMINI_MODEL, so the answer is not lost.
export async function askVisibilityQuestion(admin: SupabaseClient, prompt: string): Promise<GroundedAnswer> {
  if (!groundingEnabled()) return { result: await askGemini(prompt), citations: null, grounded: false, attempted: false };

  const { data: reserved } = await admin.rpc("grounding_reserve_capped", { p_month_limit: GROUNDING_MONTHLY_LIMIT, p_day_limit: GROUNDING_DAILY_LIMIT });
  if (!reserved) {
    return {
      result: await askGemini(prompt),
      citations: { unavailable: `Grounding limit reached (${GROUNDING_DAILY_LIMIT} per day, ${GROUNDING_MONTHLY_LIMIT} per month for the app); asked without Google Search.` },
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
