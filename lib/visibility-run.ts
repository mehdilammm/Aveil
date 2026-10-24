import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyUsage, countUsage, ENGINE_MODEL, engineConfigured, askEngine, extractNames, profileAnswer, USAGE_KEYS } from "./engines";
import { geminiConfigured } from "./gemini";
import { askVisibilityQuestion } from "./grounded-question";
import { GROUNDING_MODEL } from "./grounding";
import { planOf } from "./orders-sync";
import { PLANS } from "./plans";
import { ACCESS_METHOD } from "./markets";
import { capStatus, fitsCap } from "./usage";
import { recordUsage, usageToday } from "./usage-store";
import { taskModelEnabled } from "./task-models";
import { brandTerms, canRun, ENGINE_NAME, ENGINES, MAX_PROMPTS, nextRunAt, type EngineId } from "./visibility";

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
// options.test: "Re-run with citations (test)" for the workspace owner: skips the weekly wait (at most
// TEST_RUNS_PER_DAY runs per store in 24 h), keeps the grounding caps, and is stored as a normal run.
// options.recheck: a 7/14/30-day re-check after a verified fix: skips the weekly wait (it must run on its day to be
// compared), keeps the plan's daily request caps.
export const TEST_RUNS_PER_DAY = 3;
// The checks that decide whether a run may start (also used before a run is queued as a job).
export async function visibilityPrecheck(admin: SupabaseClient, store: Store, options: { test?: boolean; recheck?: boolean } = {}): Promise<{ runId?: string; error?: string } | null> {
  if (!ENGINES.some(engineConfigured)) return { error: "AI Visibility is not set up on the server (no AI engine key)." };
  if (options.test) {
    const { count } = await admin.from("visibility_runs").select("id", { count: "exact", head: true }).eq("store_id", store.id).gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
    if ((count ?? 0) >= TEST_RUNS_PER_DAY) return { error: `At most ${TEST_RUNS_PER_DAY} runs per store in 24 hours.` };
  }

  const { data: recent } = await admin
    .from("visibility_runs")
    .select("id, status, created_at")
    .eq("store_id", store.id)
    .neq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(1);
  const last = recent?.[0];
  if (last?.status === "running" && Date.now() - Date.parse(last.created_at) < STALE_RUN_MS) return { runId: last.id, error: "A run is already in progress." };
  if (!options.test && !options.recheck && last && last.status === "complete" && !canRun(last.created_at, new Date())) {
    return { error: `Questions can be run once a week. Next run: ${nextRunAt(last.created_at)!.toUTCString()}.` };
  }
  return null;
}

// options.budgetMs: time this run may use (a job passes what is left of its tick).
export async function runVisibility(admin: SupabaseClient, store: Store, options: { test?: boolean; recheck?: boolean; budgetMs?: number } = {}): Promise<{ runId?: string; error?: string }> {
  const engines = ENGINES.filter(engineConfigured);
  const refused = await visibilityPrecheck(admin, store, options);
  if (refused) return refused;
  const budget = Math.min(TIME_BUDGET_MS, options.budgetMs ?? TIME_BUDGET_MS);

  // Smart sampling: the plan's number of questions (Free 5, Pro and Agency 25), oldest first.
  const plan = await planOf(admin, store.id);
  const { data: prompts } = await admin.from("visibility_prompts").select("id, prompt, market, language").eq("store_id", store.id).order("created_at").limit(PLANS[plan].visibilityQuestions);
  if (!prompts?.length) return { error: "Add at least one question first." };

  // Daily AI request caps of the workspace's plan (usage_events).
  const { data: ws } = await admin.from("stores").select("workspace_id").eq("id", store.id).single();
  const workspaceId = ws?.workspace_id as string;
  const usedBefore = await usageToday(admin, workspaceId);
  const reached = capStatus(plan, usedBefore).filter((c) => c.level === "reached" && (c.provider === "gemini" || c.provider === "groq"));
  if (reached.length) return { error: `Daily AI limit reached for this workspace (${reached.map((c) => `${c.provider} ${c.used}/${c.limit}`).join(", ")}). It resets at 00:00 UTC.` };

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
    const all = USAGE_KEYS.reduce((t, e) => ({ requests: t.requests + usage[e].requests, input: t.input + usage[e].input, output: t.output + usage[e].output }), { requests: 0, input: 0, output: 0 });
    return admin.from("visibility_runs").update({ requests_count: all.requests, input_tokens: all.input, output_tokens: all.output }).eq("id", run.id);
  };

  let usedGrounding = false;
  const lane = async (engine: EngineId) => {
    let stopped: string | null = null;
    for (const [i, p] of prompts.entries()) {
      // Provenance: the market and language the question is written for, and how the model was reached.
      const row = { run_id: run.id, store_id: store.id, owner_id: store.owner_id, prompt_id: p.id, prompt: p.prompt, engine, model: ENGINE_MODEL[engine], country: p.market ?? null, language: p.language ?? null, access_method: ACCESS_METHOD.ungrounded as string };
      // About 1 answer + 2 helper requests per question: stop before the workspace's daily cap is passed.
      if (!stopped && (!fitsCap(plan, "gemini", usedBefore.gemini + usage.gemini.requests, 1) || !fitsCap(plan, "groq", usedBefore.groq + usage.groq.requests, 2))) {
        stopped = "Not asked: the workspace's daily AI limit was reached during this run. It resets at 00:00 UTC.";
      }
      if (stopped || Date.now() - started > budget) {
        await admin.from("visibility_results").insert({ ...row, error: stopped ?? "Skipped: time limit reached for this run." });
        continue;
      }
      if (i > 0) await sleep(GAP_MS);
      const before = { ...usage[engine] };
      // Gemini questions: with Google Search grounding when enabled and within the caps (see grounded-question.ts).
      const q = engine === "gemini" ? await askVisibilityQuestion(admin, p.prompt) : null;
      const r = q ? q.result : await askEngine(engine, p.prompt);
      const citations = q?.citations ?? null;
      if (q?.grounded) {
        row.model = GROUNDING_MODEL;
        row.access_method = ACCESS_METHOD.grounded;
      }
      const grounded = q?.grounded ?? false;
      if (q?.attempted && !usedGrounding) {
        usedGrounding = true;
        await admin.from("visibility_runs").update({ grounding: true }).eq("id", run.id);
      }
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
          citations,
          error,
        });
        await saveTotals();
        continue;
      }
      await sleep(GAP_MS);
      const all = emptyUsage();
      const x = await extractNames(r.text, terms, store.name, all);
      // Brand profile (Gemini answers only: visibility is Gemini's): only when someone is named.
      const p2 = engine === "gemini" && (x.analysis.mentioned || x.analysis.competitors.length)
        ? await profileAnswer(r.text, terms, store.name, x.analysis.mentioned, x.analysis.competitors, all)
        : null;
      const sum = USAGE_KEYS.reduce((t, e) => ({ requests: t.requests + all[e].requests, input: t.input + all[e].input, output: t.output + all[e].output }), { requests: 0, input: 0, output: 0 });
      for (const e of USAGE_KEYS) {
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
        input_tokens: r.inputTokens + sum.input,
        output_tokens: r.outputTokens + sum.output,
        requests: r.requests + sum.requests,
        extraction: a.method,
        extractor: x.extractor,
        profile: p2?.profile ?? null,
        grounded,
        citations,
        profiler: p2?.profile ? p2.by : null,
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
  await recordUsage(admin, { workspaceId, storeId: store.id, kind: "visibility_run", refId: run.id }, usage);
  return { runId: run.id, error: anyAnswer ? undefined : "No question got an answer." };
}

// Runs only the structured extraction on answers stored before it existed (extraction is null).
// One extraction request per answer; each answer is re-read at most once.
export async function rereadStoredAnswers(admin: SupabaseClient, store: Store): Promise<{ updated: number; error?: string }> {
  if (!geminiConfigured() && !taskModelEnabled("groq") && !taskModelEnabled("nvidia")) return { updated: 0, error: "No model is set up on the server to read the answers." };
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
    const u = emptyUsage();
    const x = await extractNames(row.answer!, terms, store.name, u);
    const used = USAGE_KEYS.reduce((t, e) => ({ requests: t.requests + u[e].requests, input: t.input + u[e].input, output: t.output + u[e].output }), { requests: 0, input: 0, output: 0 });
    const t = perRun.get(row.run_id) ?? { requests: 0, input: 0, output: 0 };
    t.requests += used.requests;
    t.input += used.input;
    t.output += used.output;
    perRun.set(row.run_id, t);
    const a = x.analysis;
    await admin
      .from("visibility_results")
      .update({
        mentioned: a.mentioned,
        mention_rank: a.rank,
        matched_terms: a.matchedTerms,
        competitors: a.competitors,
        urls: a.urls,
        extraction: a.method,
        extractor: x.extractor,
        input_tokens: row.input_tokens + used.input,
        output_tokens: row.output_tokens + used.output,
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
