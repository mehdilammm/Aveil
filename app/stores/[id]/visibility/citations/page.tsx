import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { BasisBadge, formatDate } from "@/components/badges";
import { VisibilityTabs } from "@/components/visibility-tabs";
import { getStore } from "@/lib/data";
import { citedDomains, groundingEnabled, isGrounding, type CitationRecord } from "@/lib/grounding";
import { getUser } from "@/lib/supabase/server";

export async function generateMetadata() {
  return { title: (await getTranslations("visibilityPage"))("cTitle") };
}

export default async function CitationsPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const { id } = await params;
  const { supabase } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const tv = await getTranslations("visibilityPage");

  const { data: runs } = await supabase.from("visibility_runs").select("id, created_at").eq("store_id", id).eq("status", "complete").order("created_at", { ascending: false }).limit(1);
  const run = runs?.[0];
  const { data: rows } = run
    ? await supabase.from("visibility_results").select("prompt, competitors, citations, grounded").eq("run_id", run.id).eq("engine", "gemini").not("answer", "is", null)
    : { data: [] };
  const list = (rows ?? []).map((r) => ({ prompt: r.prompt, competitors: (r.competitors as string[]) ?? [], citations: r.citations as CitationRecord | null, grounded: r.grounded as boolean }));
  const host = new URL(store.url).hostname;
  const summary = citedDomains(host, list);


  return (
    <>
      <div className="page-head">
        <h1>{tv("cTitle")}</h1>
        <p className="sub">{tv("cSub")}</p>
      </div>
      <VisibilityTabs storeId={id} active="/citations" />
      <div className="card">
        <p className="muted small">
          {groundingEnabled() ? tv("cOn") : tv("cOff")}
        </p>
      </div>
      {!run ? (
        <div className="card empty"><strong>{tv("cNone")}</strong><p>{groundingEnabled() ? tv("cRun") : tv("cTurnOn")}</p></div>
      ) : (
        <>
          <p className="muted small">Latest run: {formatDate(run.created_at, locale)}. {summary.grounded} of {list.length} answers have sources.</p>
          {list.filter((r) => r.citations && !isGrounding(r.citations)).length > 0 && (
            <div className="card">
              <p className="small"><BasisBadge basis="unavailable" /> Citations unavailable for {list.filter((r) => r.citations && !isGrounding(r.citations)).length} answers:</p>
              <ul className="small">
                {[...new Set(list.map((r) => (r.citations && !isGrounding(r.citations) ? r.citations.unavailable : null)).filter((x): x is string => !!x))].map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            </div>
          )}
          <div className="card">
            <p><BasisBadge basis="observed" /> {tv("cYours", { host, n: summary.storeCited, of: summary.grounded })}</p>
          </div>
          <h2>{tv("cMost")}</h2>
          {summary.domains.length === 0 ? (
            <p className="muted">{tv("cNoSite")}</p>
          ) : (
            <div className="card table-wrap">
              <table>
                <thead><tr><th>{tv("cSite")}</th><th>{tv("cIn")}</th><th>{tv("cWho")}</th><th>{tv("cPart")}</th></tr></thead>
                <tbody>
                  {summary.domains.slice(0, 30).map((d) => (
                    <tr key={d.domain} style={d.isStore ? { fontWeight: 600 } : undefined}>
                      <td>{d.domain}</td>
                      <td>{tv("nOf", { n: d.answers, of: summary.grounded })}</td>
                      <td>{d.isStore ? tv("yourStore") : d.competitor ? tv("competitor", { name: d.competitor }) : "—"}</td>
                      <td style={{ whiteSpace: "normal" }} className="small">{d.examples[0] ? `“${d.examples[0]}”` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h2>{tv("cAnswers")}</h2>
          {list.flatMap((r) => (isGrounding(r.citations) ? [{ ...r, citations: r.citations }] : [])).map((r, i) => (
            <div key={i} className="card finding">
              <h3>{r.prompt}</h3>
              <p className="small">{r.citations.sources.map((s) => s.domain ?? s.title).filter(Boolean).join(", ") || tv("cNoSite")}</p>
              {r.citations.queries.length > 0 && <p className="muted small">{tv("cSearches", { list: r.citations.queries.join(" · ") })}</p>}
              {r.citations.entryPoint && (
                // Google Search suggestions, which must be shown with grounded answers. Sandboxed: Google's HTML, no scripts.
                <iframe title={tv("cSuggest")} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={r.citations.entryPoint} style={{ width: "100%", height: 64, border: 0 }} />
              )}
            </div>
          ))}
        </>
      )}
    </>
  );
}
