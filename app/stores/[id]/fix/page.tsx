import { notFound } from "next/navigation";
import { formatDate } from "@/components/badges";
import { FindingCard } from "@/components/finding-card";
import { findingsForScan, getStore, listScans, sortForFixing, openJobId } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { RunScanButton } from "../run-scan-button";

export default async function FixCenterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const scanJobId = await openJobId(supabase, store.id, "scan");

  const lastComplete = (await listScans(supabase, id, 20)).find((s) => s.status === "complete");
  const findings = lastComplete ? sortForFixing(await findingsForScan(supabase, lastComplete.id)) : [];

  return (
    <>
      <div className="page-head">
        <h1>Fix Center</h1>
        <p className="sub">
          {lastComplete ? `Open findings from the scan of ${formatDate(lastComplete.finished_at)}, most serious first.` : "No complete scan yet."}
        </p>
      </div>
      <div className="card row" style={{ justifyContent: "space-between" }}>
        <span className="muted">Fixed something? Scan again to confirm it is resolved.</span>
        <RunScanButton storeId={store.id} openJobId={scanJobId} label="Rescan to verify" />
      </div>
      {lastComplete && findings.length === 0 && <p className="notice">No open findings.</p>}
      {findings.map((f) => <FindingCard key={f.finding_key} finding={f} storeUrl={store.url} />)}
    </>
  );
}
