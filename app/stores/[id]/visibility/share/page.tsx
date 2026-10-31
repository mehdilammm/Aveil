import { getTranslations, getLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { BasisBadge, formatDate } from "@/components/badges";
import { VisibilityTabs } from "@/components/visibility-tabs";
import { getStore } from "@/lib/data";
import { shareOfVoice, storePosition, type SovRun } from "@/lib/share-of-voice";
import { getUser } from "@/lib/supabase/server";

export async function generateMetadata() {
  return { title: (await getTranslations("visibilityPage"))("tabShare") };
}

export default async function ShareOfVoicePage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const { id } = await params;
  const { supabase } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const tv = await getTranslations("visibilityPage");

  const { data: runs } = await supabase.from("visibility_runs").select("id, created_at").eq("store_id", id).eq("status", "complete").order("created_at", { ascending: false }).limit(12);
  const ids = (runs ?? []).map((r) => r.id);
  const { data: rows } = ids.length
    ? await supabase.from("visibility_results").select("run_id, mentioned, competitors, answer").in("run_id", ids).eq("engine", "gemini")
    : { data: [] };
  const weeks: SovRun[] = (runs ?? []).map((run) =>
    shareOfVoice(
      store.name,
      run.id,
      run.created_at,
      (rows ?? []).filter((r) => r.run_id === run.id).map((r) => ({ run_id: r.run_id, mentioned: r.mentioned, competitors: (r.competitors as string[]) ?? [], answered: !!r.answer })),
    ),
  );
  const latest = weeks[0];
  const top = latest ? latest.entries.filter((e) => !e.isStore).slice(0, 4).map((e) => e.name) : [];

  return (
    <>
      <div className="page-head">
        <h1>{tv("tabShare")}</h1>
        <p className="sub">{tv("sSub")}</p>
      </div>
      <VisibilityTabs storeId={id} active="/share" />
      <div className="card">
        <p className="muted small"><BasisBadge basis="observed" /> {tv("sNote")}</p>
      </div>
      {!latest || latest.answered === 0 ? (
        <div className="card empty"><strong>{tv("noAnswersTitle")}</strong><p>{tv("runFirst")}</p></div>
      ) : (
        <>
          <h2>{tv("sLatest", { date: formatDate(latest.date, locale) })}</h2>
          <div className="card table-wrap">
            <table className="rtable">
              <thead><tr><th>#</th><th>{tv("sName")}</th><th>{tv("sNamedIn")}</th></tr></thead>
              <tbody>
                {latest.entries.filter((e) => e.isStore || e.questions > 0).map((e, i) => (
                  <tr key={e.name} style={e.isStore ? { fontWeight: 600 } : undefined}>
                    <td data-label="#">{e.questions > 0 ? i + 1 : "—"}</td>
                    <td data-label={tv("sName")}>{e.name}{e.isStore ? ` (${tv("yourStore")})` : ""}</td>
                    <td data-label={tv("sNamedIn")}>{tv("nOfQ", { n: e.questions, of: latest.answered })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {latest.unavailable > 0 && <p className="muted small">{tv("sNoAnswer", { n: latest.unavailable })}</p>}
          </div>

          <h2>{tv("sWeeks")}</h2>
          <div className="card table-wrap">
            <table className="rtable">
              <thead><tr><th>{tv("sRun")}</th><th>{tv("yourStoreCap")}</th><th>{tv("sPosition")}</th>{top.map((n) => <th key={n}>{n}</th>)}</tr></thead>
              <tbody>
                {weeks.map((w) => {
                  const pos = storePosition(w);
                  return (
                    <tr key={w.runId}>
                      <td data-label={tv("sRun")}>{w.date.slice(0, 10)}</td>
                      <td data-label={tv("yourStoreCap")}>{tv("nOf", { n: w.entries.find((e) => e.isStore)?.questions ?? 0, of: w.answered })}</td>
                      <td data-label={tv("sPosition")}>{pos ?? tv("notNamed")}</td>
                      {top.map((n) => <td data-label={n} key={n}>{tv("nOf", { n: w.entries.find((e) => e.name.toLowerCase() === n.toLowerCase())?.questions ?? 0, of: w.answered })}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
