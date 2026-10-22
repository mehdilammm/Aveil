import { notFound } from "next/navigation";
import { BasisBadge, formatDate } from "@/components/badges";
import { VisibilityTabs } from "@/components/visibility-tabs";
import { getStore } from "@/lib/data";
import { shareOfVoice, storePosition, type SovRun } from "@/lib/share-of-voice";
import { getUser } from "@/lib/supabase/server";

export const metadata = { title: "Share of voice · AI Visibility" };

export default async function ShareOfVoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();

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
        <h1>Share of voice</h1>
        <p className="sub">In how many of your questions the AI names your store, and each store it names instead.</p>
      </div>
      <VisibilityTabs storeId={id} active="/share" />
      <div className="card">
        <p className="muted small"><BasisBadge basis="observed" /> Counted from the Gemini answers of each weekly run: &ldquo;named in X of Y questions&rdquo;. Questions without an answer are counted apart. No score is computed.</p>
      </div>
      {!latest || latest.answered === 0 ? (
        <div className="card empty"><strong>No answers yet</strong><p>Run the questions in AI Visibility first.</p></div>
      ) : (
        <>
          <h2>Latest run ({formatDate(latest.date)})</h2>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>#</th><th>Name</th><th>Named in</th></tr></thead>
              <tbody>
                {latest.entries.filter((e) => e.isStore || e.questions > 0).map((e, i) => (
                  <tr key={e.name} style={e.isStore ? { fontWeight: 600 } : undefined}>
                    <td>{e.questions > 0 ? i + 1 : "—"}</td>
                    <td>{e.name}{e.isStore ? " (your store)" : ""}</td>
                    <td>{e.questions} of {latest.answered} questions</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {latest.unavailable > 0 && <p className="muted small">{latest.unavailable} question{latest.unavailable === 1 ? "" : "s"} had no answer in this run (not counted).</p>}
          </div>

          <h2>Week by week</h2>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>Run</th><th>Your store</th><th>Position</th>{top.map((n) => <th key={n}>{n}</th>)}</tr></thead>
              <tbody>
                {weeks.map((w) => {
                  const pos = storePosition(w);
                  return (
                    <tr key={w.runId}>
                      <td>{w.date.slice(0, 10)}</td>
                      <td>{w.entries.find((e) => e.isStore)?.questions ?? 0} of {w.answered}</td>
                      <td>{pos ?? "not named"}</td>
                      {top.map((n) => <td key={n}>{w.entries.find((e) => e.name.toLowerCase() === n.toLowerCase())?.questions ?? 0} of {w.answered}</td>)}
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
