import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askGemini, GEMINI_MODEL, geminiConfigured } from "./gemini";
import { brandTerms, canRun, combineAnalysis, EXTRACTION_SCHEMA, extractionPrompt, MAX_PROMPTS, nextRunAt, parseExtraction } from "./visibility";

type Store = { id: string; owner_id: string; name: string; url: string };

const GAP_MS = 1200; // between questions, to stay under the API rate limit
const TIME_BUDGET_MS = 260_000;
const STALE_RUN_MS = 15 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Asks every question of the store once. One run per store every 7 days; failed runs do not count.
export async function runVisibility(admin: SupabaseClient, store: Store): Promise<{ runId?: string; error?: string }> {
  if (!geminiConfigured()) return { error: "AI Visibility is not set up on the server (GEMINI_API_KEY missing)." };

  const { data: recent } = await admin
    .from("visibility_runs")
    .select("id, status, created_at")
    .eq("store_id", store.id)
    .neq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(1);
  const last = recent?.[0];
  if (last?.status === "running" && Date.now() - Date.parse(last.created_at) < STALE_RUN_MS) return { runId: last.id, error: "A run is already in progress." };
  if (last && last.status === "complete" && !canRun(last.created_at, new Date())) {
    return { error: `Questions can be run once a week. Next run: ${nextRunAt(last.created_at)!.toUTCString()}.` };
  }

  const { data: prompts } = await admin.from("visibility_prompts").select("id, prompt").eq("store_id", store.id).order("created_at").limit(MAX_PROMPTS);
  if (!prompts?.length) return { error: "Add at least one question first." };

  const { data: run, error: runErr } = await admin
    .from("visibility_runs")
    .insert({ store_id: store.id, owner_id: store.owner_id, model: GEMINI_MODEL, grounding: false, prompts_count: prompts.length })
    .select("id")
    .single();
  if (runErr || !run) return { error: "Could not start the run." };

  const terms = brandTerms(store.name, store.url);
  const started = Date.now();
  const totals = { requests: 0, input: 0, output: 0, failed: 0 };

  for (const [i, p] of prompts.entries()) {
    if (i > 0) await sleep(GAP_MS);
    if (Date.now() - started > TIME_BUDGET_MS) {
      await admin.from("visibility_results").insert({ run_id: run.id, store_id: store.id, owner_id: store.owner_id, prompt_id: p.id, prompt: p.prompt, error: "Skipped: time limit reached for this run." });
      totals.failed++;
      continue;
    }
    const r = await askGemini(p.prompt);
    totals.requests += r.requests;
    const row = { run_id: run.id, store_id: store.id, owner_id: store.owner_id, prompt_id: p.id, prompt: p.prompt };
    if (!r.ok || r.blocked || !r.text) {
      totals.failed++;
      if (r.ok) {
        totals.input += r.inputTokens;
        totals.output += r.outputTokens;
      }
      await admin.from("visibility_results").insert({
        ...row,
        finish_reason: r.ok ? r.finishReason : null,
        input_tokens: r.ok ? r.inputTokens : 0,
        output_tokens: r.ok ? r.outputTokens : 0,
        error: !r.ok ? r.error : r.blocked ? `Blocked by Gemini: ${r.blocked}` : "Empty answer",
      });
    } else {
      // Second, small request: the model lists the shops named in its answer as JSON. Falls back to the text heuristic.
      await sleep(GAP_MS);
      const x = await askGemini(extractionPrompt(r.text, store.name, terms.host), { jsonSchema: EXTRACTION_SCHEMA, maxOutputTokens: 512 });
      totals.requests += x.requests;
      const xIn = x.ok ? x.inputTokens : 0;
      const xOut = x.ok ? x.outputTokens : 0;
      totals.input += r.inputTokens + xIn;
      totals.output += r.outputTokens + xOut;
      const a = combineAnalysis(r.text, terms, x.ok ? parseExtraction(x.text) : null);
      await admin.from("visibility_results").insert({
        ...row,
        answer: r.text,
        mentioned: a.mentioned,
        mention_rank: a.rank,
        matched_terms: a.matchedTerms,
        competitors: a.competitors,
        urls: a.urls,
        finish_reason: r.finishReason,
        input_tokens: r.inputTokens + xIn,
        output_tokens: r.outputTokens + xOut,
        extraction: a.method,
      });
    }
    await admin.from("visibility_runs").update({ requests_count: totals.requests, input_tokens: totals.input, output_tokens: totals.output }).eq("id", run.id);
  }

  const allFailed = totals.failed === prompts.length;
  await admin
    .from("visibility_runs")
    .update({
      status: allFailed ? "failed" : "complete",
      finished_at: new Date().toISOString(),
      error: allFailed ? "No question got an answer. See each question for the error." : totals.failed ? `${totals.failed} of ${prompts.length} questions failed.` : null,
    })
    .eq("id", run.id);
  return { runId: run.id, error: allFailed ? "No question got an answer from Gemini." : undefined };
}

// Runs only the structured extraction on answers stored before it existed (extraction is null).
// One extraction request per answer; each answer is re-read at most once.
export async function rereadStoredAnswers(admin: SupabaseClient, store: Store): Promise<{ updated: number; error?: string }> {
  if (!geminiConfigured()) return { updated: 0, error: "AI Visibility is not set up on the server (GEMINI_API_KEY missing)." };
  const { data: rows } = await admin
    .from("visibility_results")
    .select("id, run_id, answer, input_tokens, output_tokens")
    .eq("store_id", store.id)
    .is("extraction", null)
    .not("answer", "is", null)
    .order("created_at", { ascending: false })
    .limit(MAX_PROMPTS);
  if (!rows?.length) return { updated: 0, error: "No stored answers need re-reading." };

  const terms = brandTerms(store.name, store.url);
  const started = Date.now();
  const perRun = new Map<string, { requests: number; input: number; output: number }>();
  let updated = 0;
  for (const [i, row] of rows.entries()) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    if (i > 0) await sleep(GAP_MS);
    const x = await askGemini(extractionPrompt(row.answer!, store.name, terms.host), { jsonSchema: EXTRACTION_SCHEMA, maxOutputTokens: 512 });
    const t = perRun.get(row.run_id) ?? { requests: 0, input: 0, output: 0 };
    t.requests += x.requests;
    if (x.ok) {
      t.input += x.inputTokens;
      t.output += x.outputTokens;
    }
    perRun.set(row.run_id, t);
    const a = combineAnalysis(row.answer!, terms, x.ok ? parseExtraction(x.text) : null);
    await admin
      .from("visibility_results")
      .update({
        mentioned: a.mentioned,
        mention_rank: a.rank,
        matched_terms: a.matchedTerms,
        competitors: a.competitors,
        urls: a.urls,
        extraction: a.method,
        input_tokens: row.input_tokens + (x.ok ? x.inputTokens : 0),
        output_tokens: row.output_tokens + (x.ok ? x.outputTokens : 0),
      })
      .eq("id", row.id);
    updated++;
  }

  // Add the extra requests and tokens to the runs they belong to, so monthly usage stays complete.
  for (const [runId, t] of perRun) {
    const { data: run } = await admin.from("visibility_runs").select("requests_count, input_tokens, output_tokens").eq("id", runId).single();
    if (run) {
      await admin
        .from("visibility_runs")
        .update({ requests_count: run.requests_count + t.requests, input_tokens: run.input_tokens + t.input, output_tokens: run.output_tokens + t.output })
        .eq("id", runId);
    }
  }
  return { updated };
}
