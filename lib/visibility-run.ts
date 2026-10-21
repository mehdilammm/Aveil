import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyUsage, countUsage, ENGINE_MODEL, engineConfigured, askEngine, extractNames } from "./engines";
import { askGemini, geminiConfigured } from "./gemini";
import { brandTerms, canRun, combineAnalysis, ENGINE_NAME, ENGINES, EXTRACTION_MAX_TOKENS, EXTRACTION_SCHEMA, extractionPrompt, MAX_PROMPTS, nextRunAt, parseExtraction, type EngineId } from "./visibility";

type Store = { id: string; owner_id: string; name: string; url: string };

const GAP_MS = 1200; // between questions, to stay under the API rate limit
const TIME_BUDGET_MS = 260_000;
const STALE_RUN_MS = 15 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Engines that keep failing in a run (bad key, free-plan limit) are stopped for the rest of the run.
function isFatal(error: string): boolean {
  return /\b(401|403)\b|not set|API key|quota|rate limit/i.test(error);
}

// Asks every question of the store once to each configured engine (Gemini, Mistral). One run per store every
// 7 days; failed runs do not count. Each engine runs in its own lane, one request at a time, so the free plans'
// rate limits are respected while both engines progress side by side.
export async function runVisibility(admin: SupabaseClient, store: Store): Promise<{ runId?: string; error?: string }> {
  const engines = ENGINES.filter(engineConfigured);
  if (!engines.length) return { error: "AI Visibility is not set up on the server (no AI engine key)." };

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
    .insert({
      store_id: store.id,
      owner_id: store.owner_id,
      engine: engines.length > 1 ? "multi" : engines[0],
      model: engines.map((e) => ENGINE_MODEL[e]).join(", "),
      grounding: false,
      prompts_count: prompts.length,
    })
    .select("id")
    .single();
  if (runErr || !run) return { error: "Could not start the run." };

  const terms = brandTerms(store.name, store.url);
  const started = Date.now();
  const usage = emptyUsage();
  const answered: Record<EngineId, number> = { gemini: 0, mistral: 0 };
  const saveTotals = () => {
    const all = ENGINES.reduce((t, e) => ({ requests: t.requests + usage[e].requests, input: t.input + usage[e].input, output: t.output + usage[e].output }), { requests: 0, input: 0, output: 0 });
    return admin.from("visibility_runs").update({ requests_count: all.requests, input_tokens: all.input, output_tokens: all.output }).eq("id", run.id);
  };

  const lane = async (engine: EngineId) => {
    let stopped: string | null = null;
    for (const [i, p] of prompts.entries()) {
      const row = { run_id: run.id, store_id: store.id, owner_id: store.owner_id, prompt_id: p.id, prompt: p.prompt, engine, model: ENGINE_MODEL[engine] };
      if (stopped || Date.now() - started > TIME_BUDGET_MS) {
        await admin.from("visibility_results").insert({ ...row, error: stopped ?? "Skipped: time limit reached for this run." });
        continue;
      }
      if (i > 0) await sleep(GAP_MS);
      const before = { ...usage[engine] };
      const r = await askEngine(engine, p.prompt);
      countUsage(usage, engine, r);
      if (!r.ok || r.blocked || !r.text) {
        const error = !r.ok ? r.error : r.blocked ? `Blocked by ${ENGINE_NAME[engine]}: ${r.blocked}` : "Empty answer";
        if (!r.ok && isFatal(r.error)) stopped = `Not asked: ${ENGINE_NAME[engine]} stopped earlier in this run (${r.error}).`;
        await admin.from("visibility_results").insert({
          ...row,
          finish_reason: r.ok ? r.finishReason : null,
          input_tokens: usage[engine].input - before.input,
          output_tokens: usage[engine].output - before.output,
          requests: usage[engine].requests - before.requests,
          error,
        });
        await saveTotals();
        continue;
      }
      await sleep(GAP_MS);
      const all = emptyUsage();
      const x = await extractNames(engine, r.text, terms, store.name, all);
      for (const e of ENGINES) {
        usage[e].requests += all[e].requests;
        usage[e].input += all[e].input;
        usage[e].output += all[e].output;
      }
      const a = x.analysis;
      answered[engine]++;
      await admin.from("visibility_results").insert({
        ...row,
        answer: r.text,
        mentioned: a.mentioned,
        mention_rank: a.rank,
        matched_terms: a.matchedTerms,
        competitors: a.competitors,
        urls: a.urls,
        finish_reason: r.finishReason,
        input_tokens: r.inputTokens + all.gemini.input + all.mistral.input,
        output_tokens: r.outputTokens + all.gemini.output + all.mistral.output,
        requests: r.requests + all.gemini.requests + all.mistral.requests,
        extraction: a.method,
        extractor: x.extractor,
      });
      await saveTotals();
    }
  };

  await Promise.all(engines.map(lane));

  const anyAnswer = engines.some((e) => answered[e] > 0);
  const failedEngines = engines.filter((e) => answered[e] === 0).map((e) => ENGINE_NAME[e]);
  await admin
    .from("visibility_runs")
    .update({
      status: anyAnswer ? "complete" : "failed",
      finished_at: new Date().toISOString(),
      error: !anyAnswer ? "No question got an answer. See each question for the error." : failedEngines.length ? `${failedEngines.join(", ")} gave no answer in this run.` : null,
    })
    .eq("id", run.id);
  await saveTotals();
  return { runId: run.id, error: anyAnswer ? undefined : "No question got an answer." };
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
    const x = await askGemini(extractionPrompt(row.answer!, store.name, terms.host), { jsonSchema: EXTRACTION_SCHEMA, maxOutputTokens: EXTRACTION_MAX_TOKENS });
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
        extractor: a.method === "model" ? "gemini" : null,
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
