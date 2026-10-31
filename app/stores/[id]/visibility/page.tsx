import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { BasisBadge, formatDate } from "@/components/badges";
import { EmptyState, PageHead, StatStrip } from "@/components/ui";
import { getStore, openJobId } from "@/lib/data";
import { getTranslations } from "next-intl/server";
import type { MarketId } from "@/lib/markets";
import { ENGINE_MODEL, engineConfigured } from "@/lib/engines";
import { MISTRAL_OFF_REASON } from "@/lib/mistral";
import { VisibilityTabs } from "@/components/visibility-tabs";
import { GEMINI_DISCLAIMER } from "@/lib/public-scan";
import { getUser } from "@/lib/supabase/server";
import { canRun, ENGINE_LABEL, ENGINE_NAME, ENGINES, nextRunAt, TASK_BY_LABEL, type EngineId, type TaskById } from "@/lib/visibility";
import { deletePrompt } from "./actions";
import { OutcomeSection } from "./outcome-section";
import { PromptsForm } from "./prompts-form";
import { RereadButton, RunVisibilityButton, TestRunButton } from "./run-button";
import { storeAccess } from "@/lib/workspace";
import { UsageAlert } from "@/components/usage-alert";
import { PLANS, RUN_DAYS, type PlanId } from "@/lib/plans";
import { groundingEnabled } from "@/lib/grounding";

type Run = { id: string; status: string; model: string; created_at: string; finished_at: string | null; requests_count: number; input_tokens: number; output_tokens: number; error: string | null };
type Result = {
  run_id: string;
  prompt_id: string | null;
  prompt: string;
  engine: EngineId;
  grounded: boolean | null;
  access_method: string | null;
  country: string | null;
  language: string | null;
  model: string | null;
  answer: string | null;
  mentioned: boolean | null;
  mention_rank: number | null;
  competitors: string[];
  urls: string[];
  error: string | null;
  extraction: "model" | "heuristic" | "failed" | null;
  extractor: TaskById | "mistral" | null;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
};

function Verdict({ r, engine }: { r: Result | undefined; engine: EngineId }) {
  const tv = useTranslations("visibilityPage");
  if (!r) return <span className="muted">{engine === "mistral" && !engineConfigured("mistral") ? MISTRAL_OFF_REASON : tv("notAsked")}</span>;
  if (r.error) return <span className="muted" title={r.error}>{tv("unavailable")}</span>;
  return (
    <>
      {r.mentioned ? <span className="badge state-resolved">{tv("mentioned")}{r.mention_rank ? ` #${r.mention_rank}` : ""}</span> : <span className="badge sev-medium">{tv("notMentioned")}</span>}
      {r.extraction === "failed" ? (
        <div className="muted small">{tv("noNames")}</div>
      ) : (
        r.competitors.length > 0 && <div className="small">{r.competitors.slice(0, 6).join(", ")}{r.competitors.length > 6 ? "…" : ""}</div>
      )}
    </>
  );
}

export default async function AiVisibilityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const visibilityJobId = await openJobId(supabase, store.id, "visibility");
  const [tp, ta, tv] = await Promise.all([getTranslations("prompts"), getTranslations("answer"), getTranslations("visibilityPage")]);
  const access = user ? await storeAccess(supabase, user.id, id) : null;
  const { data: wsPlan } = access ? await supabase.from("workspaces").select("plan").eq("id", access.workspace_id).maybeSingle() : { data: null };
  const planId = ((wsPlan?.plan as PlanId | undefined) ?? "free") in PLANS ? ((wsPlan?.plan as PlanId | undefined) ?? "free") : "free";

  const [{ data: promptRows }, { data: runRows }] = await Promise.all([
    supabase.from("visibility_prompts").select("id, prompt, market, language").eq("store_id", id).order("created_at"),
    supabase.from("visibility_runs").select("id, status, model, created_at, finished_at, requests_count, input_tokens, output_tokens, error").eq("store_id", id).order("created_at", { ascending: false }).limit(12),
  ]);
  const prompts = promptRows ?? [];
  // New questions default to the market most used so far.
  const counts = new Map<string, number>();
  for (const p of prompts) if (p.market) counts.set(p.market, (counts.get(p.market) ?? 0) + 1);
  const defaultPromptMarket = ([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "US") as MarketId;
  const runs = (runRows ?? []) as Run[];
  const runIds = runs.map((r) => r.id);
  const { data: resultRows } = runIds.length
    ? await supabase
        .from("visibility_results")
        .select("run_id, prompt_id, prompt, engine, model, answer, mentioned, mention_rank, competitors, urls, error, extraction, extractor, requests, input_tokens, output_tokens, created_at, country, language, access_method, grounded")
        .in("run_id", runIds)
    : { data: [] };
  const results = (resultRows ?? []) as Result[];

  const configured = ENGINES.filter(engineConfigured);
  const lastCounted = runs.find((r) => r.status !== "failed");
  const running = runs.some((r) => r.status === "running");
  const disabledReason = !configured.length
    ? tv("dNoKey")
    : prompts.length === 0
      ? tv("dNoQuestion")
      : running
        ? tv("dRunning")
        : lastCounted && lastCounted.status === "complete" && !canRun(lastCounted.created_at, new Date(), RUN_DAYS[PLANS[planId].visibilityPer])
          ? tv("dLimit", { per: PLANS[planId].visibilityPer, plan: PLANS[planId].name, date: formatDate(nextRunAt(lastCounted.created_at, RUN_DAYS[PLANS[planId].visibilityPer])!.toISOString()) })
          : null;

  // Usage this month per engine, from the result rows (extraction requests are counted on the answer's row).
  const month = new Date().toISOString().slice(0, 7);
  const usage = Object.fromEntries(
    ENGINES.map((e) => {
      const rows = results.filter((r) => r.engine === e && r.created_at.slice(0, 7) === month);
      return [e, { requests: rows.reduce((n, r) => n + r.requests, 0), input: rows.reduce((n, r) => n + r.input_tokens, 0), output: rows.reduce((n, r) => n + r.output_tokens, 0) }];
    }),
  ) as Record<EngineId, { requests: number; input: number; output: number }>;

  const completedRuns = runs.filter((r) => r.status !== "running");
  const resultFor = (promptId: string, runId: string, engine: EngineId) => results.find((r) => r.prompt_id === promptId && r.run_id === runId && r.engine === engine);
  const latestRun = completedRuns.find((r) => results.some((x) => x.run_id === r.id));

  const latestRows = latestRun ? results.filter((r) => r.run_id === latestRun.id && !r.error && r.answer) : [];
  const mentioned = latestRows.filter((r) => r.mentioned).length;
  const named = new Set(latestRows.flatMap((r) => r.competitors)).size;

  return (
    <>
      <PageHead title={tv("title")} icon="visibility" sub={tv("sub")} action={<RunVisibilityButton storeId={store.id} disabledReason={disabledReason} openJobId={visibilityJobId} />} />
      <VisibilityTabs storeId={store.id} active="" />
      {access && <UsageAlert supabase={supabase} workspaceId={access.workspace_id} plan={planId} always />}
      <StatStrip
        stats={[
          { label: tv("statMentioned"), value: latestRun ? `${mentioned}/${latestRows.length}` : "—", tone: latestRun ? (mentioned ? "good" : "bad") : undefined, basis: latestRun ? "observed" : "unavailable", foot: latestRun ? formatDate(latestRun.created_at) : tv("notRun") },
          { label: tv("statQuestions"), value: `${prompts.length}/${PLANS[planId].visibilityQuestions}` },
          { label: tv("statOthers"), value: latestRun ? named : "—", basis: latestRun ? "heuristic" : "unavailable" },
        ]}
      />
      <h2 className="section-title">{tv("results")}</h2>
      {!latestRun ? (
        <EmptyState icon="visibility" title={tv("noAnswersTitle")} text={tv("noAnswers")} />
      ) : (
        <>
          <div className="card table-wrap">
            <table className="rtable">
              <thead>
                <tr><th>{tv("question")}</th>{ENGINES.map((e) => <th key={e}>{ENGINE_NAME[e]}</th>)}</tr>
              </thead>
              <tbody>
                {prompts.map((p) => (
                  <tr key={p.id}>
                    <td data-label="" style={{ fontWeight: 600 }} dir="auto">{p.prompt}</td>
                    {ENGINES.map((e) => (
                      <td key={e} data-label={ENGINE_NAME[e]}><Verdict r={resultFor(p.id, latestRun.id, e)} engine={e} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>{tv("answers")}</h2>
          {prompts.map((p) => {
            const rows = ENGINES.map((e) => resultFor(p.id, latestRun.id, e)).filter((r): r is Result => !!r);
            if (!rows.length) return null;
            return (
              <details key={p.id} className="card fold">
                <summary dir="auto">{p.prompt}</summary>
                {rows.map((r) => (
                  <div key={r.engine} style={{ borderTop: "1px solid var(--border)", paddingTop: 6, marginTop: 6 }}>
                    <span className="badge basis-observed">{ENGINE_LABEL[r.engine]}</span>{" "}
                    <span className={`badge ${r.grounded ? "basis-observed" : "basis-heuristic"}`}>{r.grounded ? ta("grounded") : ta("ungrounded")}</span>
                    <p className="muted small">{ta("provenance", { engine: ENGINE_NAME[r.engine], model: r.model ?? ENGINE_MODEL[r.engine], method: r.access_method ?? ta("notRecorded"), market: r.country ?? ta("notRecorded"), language: r.language ?? ta("notRecorded"), date: formatDate(r.created_at) })}</p>
                    {r.error ? (
                      <p className="muted small"><BasisBadge basis="unavailable" /> {r.error}</p>
                    ) : (
                      <>
                        {r.urls.length > 0 && (
                          <p className="small" style={{ wordBreak: "break-all" }}>
                            <strong>{tv("links")}</strong> {r.urls.map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer nofollow" style={{ marginInlineEnd: 8 }}>{u}</a>)}
                          </p>
                        )}
                        <details>
                          <summary className="muted small">What {ENGINE_NAME[r.engine]} said ({r.model ?? ENGINE_MODEL[r.engine]}){r.extractor ? ` · names read by ${r.extractor === "mistral" ? "Mistral" : TASK_BY_LABEL[r.extractor]}` : ""}</summary>
                          <pre style={{ whiteSpace: "pre-wrap", font: "inherit", fontSize: 14 }}>{r.answer}</pre>
                        </details>
                      </>
                    )}
                  </div>
                ))}
                {completedRuns.length > 1 && (
                  <div className="table-wrap" style={{ marginTop: 8 }}>
                    <table>
                      <thead><tr><th>{tv("weekOf")}</th>{ENGINES.map((e) => <th key={e}>{ENGINE_NAME[e]}</th>)}</tr></thead>
                      <tbody>
                        {completedRuns.map((run) => (
                          <tr key={run.id}>
                            <td>{run.created_at.slice(0, 10)}</td>
                            {ENGINES.map((e) => {
                              const res = resultFor(p.id, run.id, e);
                              return <td key={e}>{!res ? "—" : res.error ? tv("unavailable") : res.mentioned ? `${tv("mentioned")}${res.mention_rank ? ` (#${res.mention_rank})` : ""}` : tv("notMentioned")}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="muted small">{ta("apiNote", { date: formatDate(rows[0].created_at) })} {GEMINI_DISCLAIMER}</p>
              </details>
            );
          })}
        </>
      )}
      <details className="card fold">
        <summary>{tv("questions", { n: prompts.length, max: PLANS[planId].visibilityQuestions })}</summary>
      {prompts.length > 0 && (
        <div>
          {prompts.map((p) => (
            <form key={p.id} action={deletePrompt} className="row" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
              <input type="hidden" name="store_id" value={store.id} />
              <input type="hidden" name="prompt_id" value={p.id} />
              <span dir="auto">{p.prompt} <span className="badge basis-unavailable small">{p.market ? tp(`m_${p.market}`) : ta("notRecorded")}</span></span>
              <button className="secondary">{tv("remove")}</button>
            </form>
          ))}
        </div>
      )}
      <PromptsForm storeId={store.id} remaining={Math.max(0, PLANS[planId].visibilityQuestions - prompts.length)} limit={PLANS[planId].visibilityQuestions} existing={prompts.map((p) => p.prompt)} defaultMarket={defaultPromptMarket} />
      </details>

      <details className="card fold">
        <summary>{tv("howItWorks")}</summary>
        <p className="row">{ENGINES.map((e) => <span key={e} className="badge basis-observed">{ENGINE_LABEL[e]}</span>)}</p>
        <p className="muted small">{tv("method", { engines: ENGINES.map((e) => `${ENGINE_NAME[e]}: ${ENGINE_MODEL[e]}${engineConfigured(e) ? "" : e === "mistral" ? ` – ${MISTRAL_OFF_REASON}` : ` – ${tv("notSetUp")}`}`).join("; ") })}</p>
        {access?.role === "owner" && groundingEnabled() && engineConfigured("gemini") && prompts.length > 0 && !running && <TestRunButton storeId={store.id} />}
        {engineConfigured("gemini") && results.filter((r) => r.engine === "gemini" && r.answer && !r.extraction).length > 0 && (
          <RereadButton storeId={store.id} count={results.filter((r) => r.engine === "gemini" && r.answer && !r.extraction).length} />
        )}
        <p className="muted small">{tv("usage", { usage: ENGINES.map((e) => `${ENGINE_NAME[e]} ${usage[e].requests} / ${usage[e].input} / ${usage[e].output}`).join(" · ") })}</p>
      </details>

      <OutcomeSection storeId={store.id} />
      {runs.some((r) => r.status === "failed") && <p className="muted small">{tv("failedRuns")}</p>}
    </>
  );
}
