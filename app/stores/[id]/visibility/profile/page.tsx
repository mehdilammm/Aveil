import { notFound } from "next/navigation";
import { BasisBadge, formatDate } from "@/components/badges";
import { VisibilityTabs } from "@/components/visibility-tabs";
import { getStore } from "@/lib/data";
import { summarizeProfiles, type AnswerProfile, type BrandSummary } from "@/lib/profile";
import { getUser } from "@/lib/supabase/server";

export const metadata = { title: "Brand profile · AI Visibility" };

function SentimentLine({ s }: { s: BrandSummary }) {
  const parts = (["positive", "neutral", "negative", "unclassified"] as const).filter((k) => s.sentiment[k] > 0).map((k) => `${k} ${s.sentiment[k]}`);
  return <span className="small">{parts.join(" · ") || "—"}</span>;
}

function Brand({ s, total }: { s: BrandSummary; total: number }) {
  return (
    <div className="card finding">
      <h3>{s.name}</h3>
      <p className="small">
        <BasisBadge basis="observed" /> Named in {s.questions} of {total} answers · tone: <SentimentLine s={s} />
      </p>
      {s.features.length > 0 && (
        <p className="small"><strong>What the answers say about it:</strong> {s.features.slice(0, 10).map((f) => `${f.text}${f.count > 1 ? ` (×${f.count})` : ""}`).join(", ")}</p>
      )}
      {s.descriptions.length > 0 && (
        <details>
          <summary className="muted small">How each answer describes it ({s.descriptions.length})</summary>
          <ul className="small">
            {s.descriptions.map((d, i) => (
              <li key={i}>&ldquo;{d.text}&rdquo; <span className="muted">— answer to: {d.prompt}</span></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default async function BrandProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();

  const { data: runs } = await supabase.from("visibility_runs").select("id, created_at").eq("store_id", id).eq("status", "complete").order("created_at", { ascending: false }).limit(1);
  const run = runs?.[0];
  const { data: rows } = run
    ? await supabase.from("visibility_results").select("prompt, mentioned, competitors, profile").eq("run_id", run.id).eq("engine", "gemini").not("answer", "is", null)
    : { data: [] };
  const summary = summarizeProfiles(store.name, (rows ?? []).map((r) => ({ prompt: r.prompt, mentioned: r.mentioned, competitors: (r.competitors as string[]) ?? [], profile: r.profile as AnswerProfile | null })));

  return (
    <>
      <div className="page-head">
        <h1>Brand profile</h1>
        <p className="sub">How the AI answers describe your store compared with the stores they name instead.</p>
      </div>
      <VisibilityTabs storeId={id} active="/profile" />
      <div className="card">
        <p className="muted small">
          From the real Gemini answers of the latest run only{run ? ` (${formatDate(run.created_at)})` : ""}. This is what the model said, not a fact checked by AgentScope.
          Tone, descriptions and features are read out of each answer by an internal helper model; features are kept only when their words are in the answer.
          {summary.answers > 0 && ` ${summary.profiled} of ${summary.answers} answers have a profile.`}
        </p>
      </div>
      {!run || summary.answers === 0 ? (
        <div className="card empty"><strong>No answers yet</strong><p>Run the questions in AI Visibility first.</p></div>
      ) : (
        <>
          <h2>Your store</h2>
          {summary.store.questions === 0 ? (
            <div className="card"><p className="small"><BasisBadge basis="observed" /> Not named in any of the {summary.answers} answers, so there is no description of your store.</p></div>
          ) : (
            <Brand s={summary.store} total={summary.answers} />
          )}
          <h2>Stores named instead ({summary.competitors.length})</h2>
          {summary.competitors.length === 0 ? <p className="muted">No other store was named.</p> : summary.competitors.map((c) => <Brand key={c.name} s={c} total={summary.answers} />)}
        </>
      )}
    </>
  );
}
