import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate } from "@/components/badges";
import { FindingCard } from "@/components/finding-card";
import { ACCESS_NOTE } from "@/lib/access";
import { areaOf, AREAS } from "@/lib/categories";
import { findingsForScan, getStore, listScans, sortForFixing } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { RunScanButton } from "./run-scan-button";

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();

  const scans = await listScans(supabase, id, 20);
  const last = scans[0];
  const lastComplete = scans.find((s) => s.status === "complete");
  const findings = lastComplete ? sortForFixing(await findingsForScan(supabase, lastComplete.id)) : [];
  const areas = AREAS.map((a) => {
    const inArea = findings.filter((f) => areaOf(f) === a.key);
    return {
      ...a,
      total: inArea.length,
      high: inArea.filter((f) => f.severity === "high").length,
      medium: inArea.filter((f) => f.severity === "medium").length,
      low: inArea.filter((f) => f.severity === "low").length,
      unavailable: inArea.filter((f) => f.basis === "unavailable").length,
    };
  });

  return (
    <>
      <div className="page-head">
        <h1>{store.name}</h1>
        <p className="sub">
          {store.url} · <span className={`status-${store.connection_status}`}>{store.connection_status}</span>
        </p>
        {store.connection_status === "error" && store.connection_error && <p className="error">{store.connection_error}</p>}
      </div>

      {!last ? (
        <div className="card empty">
          <strong>No scan yet</strong>
          <p>Run the first scan to see how ready this store is for AI shopping agents.</p>
          <RunScanButton storeId={store.id} label="Run first scan" />
        </div>
      ) : (
        <>
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="muted">Last scan</div>
                <strong>{formatDate(last.finished_at ?? last.started_at)}</strong> · {last.status}
                {last.status === "failed" && last.error && <p className="error">{last.error}</p>}
                {lastComplete && <div className="muted">{lastComplete.scanned_products ?? 0} products scanned</div>}
              </div>
              <RunScanButton storeId={store.id} label="Rescan" />
            </div>
          </div>

          {lastComplete && (
            <>
              <h2>Agent Readiness</h2>
              <p className="muted">Open findings per area from the last scan. Counts only, no score.</p>
              <div className="areas">
                {areas.map((a) => (
                  <div key={a.key} className="card area">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <strong>{a.label}</strong>
                      <span className="area-total">{a.total}</span>
                    </div>
                    <p className="muted small">{a.description}</p>
                    <div className="row small">
                      <span className="badge sev-high">{a.high} critical</span>
                      <span className="badge sev-medium">{a.medium} warning</span>
                      <span className="badge sev-low">{a.low} low</span>
                    </div>
                    {a.unavailable > 0 && <p className="muted small">{a.unavailable} could not be checked (unavailable).</p>}
                    {a.key === "access" && <p className="muted small">{ACCESS_NOTE}</p>}
                  </div>
                ))}
              </div>

              <h2>Top 5 to fix</h2>
              {findings.length === 0 ? (
                <p className="notice">Nothing to fix. Every check passed.</p>
              ) : (
                <>
                  {findings.slice(0, 5).map((f) => <FindingCard key={f.finding_key} finding={f} storeUrl={store.url} />)}
                  {findings.length > 5 && <p><Link href={`/stores/${store.id}/fix`}>See all {findings.length} in Fix Center →</Link></p>}
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
