import { notFound } from "next/navigation";
import { formatDate } from "@/components/badges";
import { deltasForScans, getStore, listScans } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";

export default async function ReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();

  const scans = await listScans(supabase, id, 50);
  const deltas = await deltasForScans(supabase, scans);
  const lastComplete = scans.find((s) => s.status === "complete");

  return (
    <>
      <div className="page-head">
        <h1>Reports</h1>
        <p className="sub">Download findings and review scan history.</p>
      </div>

      <div className="card row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>Findings of the latest scan (CSV)</strong>
          <div className="muted">{lastComplete ? formatDate(lastComplete.finished_at) : "No complete scan yet"}</div>
        </div>
        {lastComplete && <a className="button" href={`/api/stores/${store.id}/report.csv`} download>Download CSV</a>}
      </div>

      <h2>Scan history</h2>
      {scans.length === 0 ? (
        <p className="muted">No scans yet.</p>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Status</th><th className="num">Products</th><th className="num">Critical</th><th className="num">Warnings</th><th className="num">Low</th>
                <th className="num">New</th><th className="num">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => {
                const c = s.severity_counts ?? {};
                const d = deltas.get(s.id);
                return (
                  <tr key={s.id}>
                    <td>{formatDate(s.finished_at ?? s.started_at)}</td>
                    <td className={s.status === "failed" ? "error" : undefined}>{s.status}</td>
                    <td className="num">{s.scanned_products ?? "—"}</td>
                    <td className="num">{s.status === "complete" ? c.high ?? 0 : "—"}</td>
                    <td className="num">{s.status === "complete" ? c.medium ?? 0 : "—"}</td>
                    <td className="num">{s.status === "complete" ? c.low ?? 0 : "—"}</td>
                    <td className="num">{d?.new ?? "—"}</td>
                    <td className="num">{d?.resolved ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
