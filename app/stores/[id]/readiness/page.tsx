import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate } from "@/components/badges";
import { deltasForScans, getStore, listScans, openJobId } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { RunScanButton } from "../run-scan-button";

export default async function ReadinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const scanJobId = await openJobId(supabase, store.id, "scan");

  const scans = await listScans(supabase, id, 30);
  const deltas = await deltasForScans(supabase, scans);

  return (
    <>
      <div className="page-head">
        <h1>Store Readiness</h1>
        <p className="sub">Every scan compared with the one before it.</p>
      </div>
      <RunScanButton storeId={store.id} openJobId={scanJobId} />
      <h2>Scan history</h2>
      {scans.length === 0 ? (
        <p className="muted">No scans yet.</p>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Status</th><th className="num">Products</th><th className="num">Findings</th>
                <th className="num">New</th><th className="num">Ongoing</th><th className="num">Recurred</th><th className="num">Resolved</th><th></th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => {
                const d = deltas.get(s.id);
                return (
                  <tr key={s.id}>
                    <td>{formatDate(s.finished_at ?? s.started_at)}</td>
                    <td className={s.status === "failed" ? "error" : undefined} title={s.error ?? undefined}>{s.status}</td>
                    <td className="num">{s.scanned_products ?? "—"}</td>
                    <td className="num">{s.findings_count ?? "—"}</td>
                    <td className="num">{d?.new ?? "—"}</td>
                    <td className="num">{d?.ongoing ?? "—"}</td>
                    <td className="num">{d?.recurred ?? "—"}</td>
                    <td className="num status-connected">{d?.resolved ?? "—"}</td>
                    <td>{s.status === "complete" && <Link href={`/stores/${store.id}/scans/${s.id}`}>Details</Link>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {scans.some((s) => s.status === "failed" && s.error) && (
        <p className="muted">Failed scans: {[...new Set(scans.filter((s) => s.status === "failed" && s.error).map((s) => s.error))].join(" · ")}</p>
      )}
    </>
  );
}
