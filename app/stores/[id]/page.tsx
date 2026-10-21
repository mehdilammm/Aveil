import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate } from "@/components/badges";
import { FindingCard } from "@/components/finding-card";
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
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;

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
              <div className="grid">
                <div className="stat high"><div className="label">Critical</div><div className="value">{counts.high}</div></div>
                <div className="stat medium"><div className="label">Warnings</div><div className="value">{counts.medium}</div></div>
                <div className="stat low"><div className="label">Low</div><div className="value">{counts.low}</div></div>
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
