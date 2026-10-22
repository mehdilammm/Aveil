import { notFound } from "next/navigation";
import { formatDate } from "@/components/badges";
import { getStore } from "@/lib/data";
import { ENGINE_MODEL, engineConfigured } from "@/lib/engines";
import { MISTRAL_OFF_REASON } from "@/lib/mistral";
import { VisibilityTabs } from "@/components/visibility-tabs";
import { GEMINI_DISCLAIMER } from "@/lib/public-scan";
import { getUser } from "@/lib/supabase/server";
import { canRun, ENGINE_LABEL, ENGINE_NAME, ENGINES, MAX_PROMPTS, nextRunAt, TASK_BY_LABEL, type EngineId, type TaskById } from "@/lib/visibility";
import { deletePrompt } from "./actions";
import { PromptsForm } from "./prompts-form";
import { RereadButton, RunVisibilityButton, TestRunButton } from "./run-button";
import { storeAccess } from "@/lib/workspace";
import { groundingEnabled } from "@/lib/grounding";

type Run = { id: string; status: string; model: string; created_at: string; finished_at: string | null; requests_count: number; input_tokens: number; output_tokens: number; error: string | null };
type Result = {
  run_id: string;
  prompt_id: string | null;
  prompt: string;
  engine: EngineId;
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
  if (!r) return <span className="muted">{engine === "mistral" && !engineConfigured("mistral") ? MISTRAL_OFF_REASON : "not asked"}</span>;
  if (r.error) return <span className="muted" title={r.error}>unavailable</span>;
  return (
    <>
      {r.mentioned ? <span className="badge state-resolved">Mentioned{r.mention_rank ? ` #${r.mention_rank}` : ""}</span> : <span className="badge sev-medium">Not mentioned</span>}
      {r.extraction === "failed" ? (
        <div className="muted small">could not extract names</div>
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
  const access = user ? await storeAccess(supabase, user.id, id) : null;

  const [{ data: promptRows }, { data: runRows }] = await Promise.all([
    supabase.from("visibility_prompts").select("id, prompt").eq("store_id", id).order("created_at"),
    supabase.from("visibility_runs").select("id, status, model, created_at, finished_at, requests_count, input_tokens, output_tokens, error").eq("store_id", id).order("created_at", { ascending: false }).limit(12),
  ]);
  const prompts = promptRows ?? [];
  const runs = (runRows ?? []) as Run[];
  const runIds = runs.map((r) => r.id);
  const { data: resultRows } = runIds.length
    ? await supabase
        .from("visibility_results")
        .select("run_id, prompt_id, prompt, engine, model, answer, mentioned, mention_rank, competitors, urls, error, extraction, extractor, requests, input_tokens, output_tokens, created_at")
        .in("run_id", runIds)
    : { data: [] };
  const results = (resultRows ?? []) as Result[];

  const configured = ENGINES.filter(engineConfigured);
  const lastCounted = runs.find((r) => r.status !== "failed");
  const running = runs.some((r) => r.status === "running");
  const disabledReason = !configured.length
    ? "Not set up on the server yet (no AI engine key)."
    : prompts.length === 0
      ? "Add at least one question first."
      : running
        ? "A run is in progress."
        : lastCounted && lastCounted.status === "complete" && !canRun(lastCounted.created_at, new Date())
          ? `Once a week. Next run: ${formatDate(nextRunAt(lastCounted.created_at)!.toISOString())}.`
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

  return (
    <>
      <div className="page-head">
        <h1>AI Visibility</h1>
        <p className="sub">Whether your store appears when people ask an AI assistant about what you sell.</p>
      </div>
      <VisibilityTabs storeId={store.id} active="" />

      <div className="card">
        {ENGINES.map((e) => (
          <span key={e} className="badge basis-observed" style={{ marginRight: 6 }}>{ENGINE_LABEL[e]}</span>
        ))}
        <p className="muted small">
          Each question is sent once to each engine ({ENGINES.map((e) => `${ENGINE_NAME[e]}: ${ENGINE_MODEL[e]}${engineConfigured(e) ? "" : e === "mistral" ? ` – ${MISTRAL_OFF_REASON}` : " – not set up"}`).join("; ")}), without web search,
          as a plain question. The apps and other runs can answer differently. A mention here is what this answer said, not proof that AI recommends your store.
          Other store names are read from each answer by a small internal helper model (structured output) and filtered; they can still be wrong. No score is computed.
        </p>
      </div>

      <h2>Questions ({prompts.length}/{MAX_PROMPTS})</h2>
      {prompts.length > 0 && (
        <div className="card">
          {prompts.map((p) => (
            <form key={p.id} action={deletePrompt} className="row" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
              <input type="hidden" name="store_id" value={store.id} />
              <input type="hidden" name="prompt_id" value={p.id} />
              <span>{p.prompt}</span>
              <button className="secondary" style={{ padding: "4px 10px" }}>Remove</button>
            </form>
          ))}
        </div>
      )}
      <PromptsForm storeId={store.id} remaining={MAX_PROMPTS - prompts.length} existing={prompts.map((p) => p.prompt)} />

      <h2>Run</h2>
      <div className="card">
        <RunVisibilityButton storeId={store.id} disabledReason={disabledReason} />
        {access?.role === "owner" && groundingEnabled() && engineConfigured("gemini") && prompts.length > 0 && !running && <TestRunButton storeId={store.id} />}
        {engineConfigured("gemini") && results.filter((r) => r.engine === "gemini" && r.answer && !r.extraction).length > 0 && (
          <RereadButton storeId={store.id} count={results.filter((r) => r.engine === "gemini" && r.answer && !r.extraction).length} />
        )}
        <p className="muted small">
          This month: {ENGINES.map((e) => `${ENGINE_NAME[e]} ${usage[e].requests} requests, ${usage[e].input} input and ${usage[e].output} output tokens`).join(" · ")}.
        </p>
      </div>

      <h2>Results</h2>
      {!latestRun ? (
        <div className="card empty">
          <strong>No answers yet</strong>
          <p>Add questions and run them. Nothing is estimated.</p>
        </div>
      ) : (
        <>
          <p className="muted small">Latest run: {formatDate(latestRun.created_at)}.</p>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr><th>Question</th>{ENGINES.map((e) => <th key={e}>{ENGINE_NAME[e]}</th>)}</tr>
              </thead>
              <tbody>
                {prompts.map((p) => (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: "normal", minWidth: 160 }}>{p.prompt}</td>
                    {ENGINES.map((e) => (
                      <td key={e} style={{ whiteSpace: "normal", minWidth: 140 }}><Verdict r={resultFor(p.id, latestRun.id, e)} engine={e} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {prompts.map((p) => {
            const rows = ENGINES.map((e) => resultFor(p.id, latestRun.id, e)).filter((r): r is Result => !!r);
            if (!rows.length) return null;
            return (
              <div key={p.id} className="card finding">
                <h3>{p.prompt}</h3>
                {rows.map((r) => (
                  <div key={r.engine} style={{ borderTop: "1px solid var(--border)", paddingTop: 6, marginTop: 6 }}>
                    <span className="badge basis-observed">{ENGINE_LABEL[r.engine]}</span>
                    {r.error ? (
                      <p className="muted small">Unavailable: {r.error}</p>
                    ) : (
                      <>
                        {r.urls.length > 0 && (
                          <p className="small" style={{ wordBreak: "break-all" }}>
                            <strong>Links in the answer:</strong> {r.urls.map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer nofollow" style={{ marginRight: 8 }}>{u}</a>)}
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
                      <thead><tr><th>Week of</th>{ENGINES.map((e) => <th key={e}>{ENGINE_NAME[e]}</th>)}</tr></thead>
                      <tbody>
                        {completedRuns.map((run) => (
                          <tr key={run.id}>
                            <td>{run.created_at.slice(0, 10)}</td>
                            {ENGINES.map((e) => {
                              const res = resultFor(p.id, run.id, e);
                              return <td key={e}>{!res ? "—" : res.error ? "unavailable" : res.mentioned ? `mentioned${res.mention_rank ? ` (#${res.mention_rank})` : ""}` : "not mentioned"}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="muted small">{GEMINI_DISCLAIMER}</p>
              </div>
            );
          })}
        </>
      )}
      {runs.some((r) => r.status === "failed") && <p className="muted small">Failed runs do not count toward the weekly limit.</p>}
    </>
  );
}
