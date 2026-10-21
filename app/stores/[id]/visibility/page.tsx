import { notFound } from "next/navigation";
import { formatDate } from "@/components/badges";
import { getStore } from "@/lib/data";
import { GEMINI_MODEL, geminiConfigured } from "@/lib/gemini";
import { getUser } from "@/lib/supabase/server";
import { canRun, MAX_PROMPTS, nextRunAt } from "@/lib/visibility";
import { deletePrompt } from "./actions";
import { PromptsForm } from "./prompts-form";
import { RereadButton, RunVisibilityButton } from "./run-button";

type Run = { id: string; status: string; model: string; created_at: string; finished_at: string | null; requests_count: number; input_tokens: number; output_tokens: number; error: string | null };
type Result = {
  run_id: string;
  prompt_id: string | null;
  prompt: string;
  answer: string | null;
  mentioned: boolean | null;
  mention_rank: number | null;
  competitors: string[];
  urls: string[];
  error: string | null;
  extraction: "model" | "heuristic" | null;
};

const ENGINE_LABEL = "Gemini API answer, not the Gemini app";

export default async function AiVisibilityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();

  const [{ data: promptRows }, { data: runRows }] = await Promise.all([
    supabase.from("visibility_prompts").select("id, prompt").eq("store_id", id).order("created_at"),
    supabase.from("visibility_runs").select("id, status, model, created_at, finished_at, requests_count, input_tokens, output_tokens, error").eq("store_id", id).order("created_at", { ascending: false }).limit(12),
  ]);
  const prompts = promptRows ?? [];
  const runs = (runRows ?? []) as Run[];
  const runIds = runs.map((r) => r.id);
  const { data: resultRows } = runIds.length
    ? await supabase.from("visibility_results").select("run_id, prompt_id, prompt, answer, mentioned, mention_rank, competitors, urls, error, extraction").in("run_id", runIds)
    : { data: [] };
  const results = (resultRows ?? []) as Result[];

  const lastCounted = runs.find((r) => r.status !== "failed");
  const running = runs.some((r) => r.status === "running");
  const disabledReason = !geminiConfigured()
    ? "Not set up on the server yet (GEMINI_API_KEY)."
    : prompts.length === 0
      ? "Add at least one question first."
      : running
        ? "A run is in progress."
        : lastCounted && lastCounted.status === "complete" && !canRun(lastCounted.created_at, new Date())
          ? `Once a week. Next run: ${formatDate(nextRunAt(lastCounted.created_at)!.toISOString())}.`
          : null;

  const month = new Date().toISOString().slice(0, 7);
  const monthRuns = runs.filter((r) => r.created_at.slice(0, 7) === month);
  const usage = monthRuns.reduce((u, r) => ({ requests: u.requests + r.requests_count, input: u.input + r.input_tokens, output: u.output + r.output_tokens }), { requests: 0, input: 0, output: 0 });

  const completedRuns = runs.filter((r) => r.status !== "running");
  const resultFor = (promptId: string, runId: string) => results.find((r) => r.prompt_id === promptId && r.run_id === runId);

  return (
    <>
      <div className="page-head">
        <h1>AI Visibility</h1>
        <p className="sub">Whether your store appears when people ask an AI assistant about what you sell.</p>
      </div>

      <div className="card">
        <span className="badge basis-observed">{ENGINE_LABEL}</span>
        <p className="muted small">
          Each question is sent once to the Gemini API ({GEMINI_MODEL}) without web search, as a plain question. The Gemini app, other assistants and other
          runs can answer differently. A mention here is what this answer said, not proof that AI recommends your store. Competitor names are read from the
          answer by a second small Gemini request (structured output), filtered for labels, and can still be wrong.
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
        {geminiConfigured() && results.filter((r) => r.answer && !r.extraction).length > 0 && (
          <RereadButton storeId={store.id} count={results.filter((r) => r.answer && !r.extraction).length} />
        )}
        <p className="muted small">
          This month: {usage.requests} Gemini requests, {usage.input} input and {usage.output} output tokens.
        </p>
      </div>

      <h2>Results</h2>
      {completedRuns.length === 0 ? (
        <div className="card empty">
          <strong>No answers yet</strong>
          <p>Add questions and run them. Nothing is estimated.</p>
        </div>
      ) : (
        prompts.map((p) => {
          const latestRun = completedRuns.find((r) => resultFor(p.id, r.id));
          const latest = latestRun ? resultFor(p.id, latestRun.id) : undefined;
          return (
            <div key={p.id} className="card finding">
              <h3>{p.prompt}</h3>
              {!latest ? (
                <p className="muted">Not asked yet.</p>
              ) : latest.error ? (
                <p className="error">{formatDate(latestRun!.created_at)}: {latest.error}</p>
              ) : (
                <>
                  <div className="row">
                    {latest.mentioned ? <span className="badge state-resolved">Mentioned</span> : <span className="badge sev-medium">Not mentioned</span>}
                    {latest.mentioned && <span className="muted small">{latest.mention_rank ? `#${latest.mention_rank} in the answer's list` : "not in a numbered list"}</span>}
                    <span className="muted small">{formatDate(latestRun!.created_at)}</span>
                  </div>
                  {latest.competitors.length > 0 && (
                    <p className="small">
                      <strong>Also named:</strong> {latest.competitors.join(", ")}{" "}
                      <span className="muted">({latest.extraction === "model" ? "listed by Gemini from its own answer, then filtered" : "read from the text automatically"})</span>
                    </p>
                  )}
                  {latest.urls.length > 0 && (
                    <p className="small" style={{ wordBreak: "break-all" }}>
                      <strong>Links in the answer:</strong> {latest.urls.map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer nofollow" style={{ marginRight: 8 }}>{u}</a>)}
                    </p>
                  )}
                  <details>
                    <summary className="muted small">Full answer ({ENGINE_LABEL})</summary>
                    <pre style={{ whiteSpace: "pre-wrap", font: "inherit", fontSize: 14 }}>{latest.answer}</pre>
                  </details>
                </>
              )}
              {completedRuns.length > 1 && (
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table>
                    <thead><tr><th>Week of</th><th>Result</th></tr></thead>
                    <tbody>
                      {completedRuns.map((r) => {
                        const res = resultFor(p.id, r.id);
                        return (
                          <tr key={r.id}>
                            <td>{r.created_at.slice(0, 10)}</td>
                            <td>{!res ? "—" : res.error ? "error" : res.mentioned ? `mentioned${res.mention_rank ? ` (#${res.mention_rank})` : ""}` : "not mentioned"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })
      )}
      {runs.some((r) => r.status === "failed") && <p className="muted small">Failed runs do not count toward the weekly limit.</p>}
    </>
  );
}
