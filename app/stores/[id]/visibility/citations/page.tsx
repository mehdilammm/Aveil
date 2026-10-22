import { notFound } from "next/navigation";
import { BasisBadge, formatDate } from "@/components/badges";
import { VisibilityTabs } from "@/components/visibility-tabs";
import { getStore } from "@/lib/data";
import { citedDomains, GROUNDING_DAILY_LIMIT, GROUNDING_MODEL, GROUNDING_MONTHLY_LIMIT, groundingEnabled, isGrounding, type CitationRecord } from "@/lib/grounding";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";

export const metadata = { title: "Citations · AI Visibility" };

export default async function CitationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();

  const { data: runs } = await supabase.from("visibility_runs").select("id, created_at").eq("store_id", id).eq("status", "complete").eq("grounding", true).order("created_at", { ascending: false }).limit(1);
  const run = runs?.[0];
  const { data: rows } = run
    ? await supabase.from("visibility_results").select("prompt, competitors, citations, grounded").eq("run_id", run.id).eq("engine", "gemini").not("answer", "is", null)
    : { data: [] };
  const list = (rows ?? []).map((r) => ({ prompt: r.prompt, competitors: (r.competitors as string[]) ?? [], citations: r.citations as CitationRecord | null, grounded: r.grounded as boolean }));
  const host = new URL(store.url).hostname;
  const summary = citedDomains(host, list);

  let monthUsed: number | null = null;
  try {
    const month = new Date().toISOString().slice(0, 7) + "-01";
    const { data } = await createAdminClient().from("grounding_usage").select("count").eq("month", month).maybeSingle();
    monthUsed = data?.count ?? 0;
  } catch {
    monthUsed = null;
  }

  return (
    <>
      <div className="page-head">
        <h1>Citations</h1>
        <p className="sub">Which websites the AI relies on when it answers questions about what you sell.</p>
      </div>
      <VisibilityTabs storeId={id} active="/citations" />
      <div className="card">
        <p className="muted small">
          {groundingEnabled() ? `Questions are sent to Gemini (${GROUNDING_MODEL}) with Google Search grounding; each answer lists the sources it relied on.` : "Google Search grounding is off on this server (GEMINI_GROUNDING_ENABLED is not true), so answers have no sources."}{" "}
          App-wide caps: {GROUNDING_DAILY_LIMIT} grounded requests per day and {GROUNDING_MONTHLY_LIMIT} per month{monthUsed !== null ? ` (${monthUsed} used this month)` : ""}; above them, or when Google refuses grounding, questions are asked without Google Search.
        </p>
      </div>
      {!run ? (
        <div className="card empty"><strong>No grounded answers yet</strong><p>{groundingEnabled() ? "Run the questions in AI Visibility." : "Turn grounding on, then run the questions."}</p></div>
      ) : (
        <>
          <p className="muted small">Latest run with grounding: {formatDate(run.created_at)}. {summary.grounded} of {list.length} answers have sources.</p>
          {list.filter((r) => r.citations && !isGrounding(r.citations)).length > 0 && (
            <div className="card">
              <p className="small"><BasisBadge basis="unavailable" /> Citations unavailable for {list.filter((r) => r.citations && !isGrounding(r.citations)).length} answers:</p>
              <ul className="small">
                {[...new Set(list.map((r) => (r.citations && !isGrounding(r.citations) ? r.citations.unavailable : null)).filter((x): x is string => !!x))].map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            </div>
          )}
          <div className="card">
            <p><BasisBadge basis="observed" /> Your site ({host}) is cited in <strong>{summary.storeCited} of {summary.grounded}</strong> answers with sources.</p>
          </div>
          <h2>Most cited websites</h2>
          {summary.domains.length === 0 ? (
            <p className="muted">The answers listed no website.</p>
          ) : (
            <div className="card table-wrap">
              <table>
                <thead><tr><th>Website</th><th>Cited in</th><th>Who</th><th>Part of an answer that relied on it</th></tr></thead>
                <tbody>
                  {summary.domains.slice(0, 30).map((d) => (
                    <tr key={d.domain} style={d.isStore ? { fontWeight: 600 } : undefined}>
                      <td>{d.domain}</td>
                      <td>{d.answers} of {summary.grounded}</td>
                      <td>{d.isStore ? "your store" : d.competitor ? `competitor named: ${d.competitor}` : "—"}</td>
                      <td style={{ whiteSpace: "normal" }} className="small">{d.examples[0] ? `“${d.examples[0]}”` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h2>Answers and their sources</h2>
          {list.flatMap((r) => (isGrounding(r.citations) ? [{ ...r, citations: r.citations }] : [])).map((r, i) => (
            <div key={i} className="card finding">
              <h3>{r.prompt}</h3>
              <p className="small">{r.citations.sources.map((s) => s.domain ?? s.title).filter(Boolean).join(", ") || "no website"}</p>
              {r.citations.queries.length > 0 && <p className="muted small">Google searches: {r.citations.queries.join(" · ")}</p>}
              {r.citations.entryPoint && (
                // Google Search suggestions, which must be shown with grounded answers. Sandboxed: Google's HTML, no scripts.
                <iframe title="Google Search suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={r.citations.entryPoint} style={{ width: "100%", height: 64, border: 0 }} />
              )}
            </div>
          ))}
        </>
      )}
    </>
  );
}
