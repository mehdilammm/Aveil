import { notFound } from "next/navigation";
import { formatDate } from "@/components/badges";
import { deltasForScans, getStore, listScans, weeklyReport } from "@/lib/data";
import { shareState } from "@/lib/share-report";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";
import { ShareLinks } from "./share-links";

export default async function ReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();

  const scans = await listScans(supabase, id, 50);
  const deltas = await deltasForScans(supabase, scans);
  const lastComplete = scans.find((s) => s.status === "complete");
  const weekly = await weeklyReport(supabase, scans);
  const access = user ? await storeAccess(supabase, user.id, store.id) : null;
  const { data: shareRows } = await supabase.from("share_reports").select("id, created_at, expires_at, revoked_at, views").eq("store_id", store.id).order("created_at", { ascending: false }).limit(50);
  const now = Date.now();
  const links = (shareRows ?? []).map((r) => ({ ...r, state: shareState(r, now) as "ok" | "expired" | "revoked" }));
  const titleList = (keys: string[]) => (keys.length ? <ul>{keys.map((k) => <li key={k}>{weekly?.titles.get(k) ?? k}</li>)}</ul> : <p className="muted">None.</p>);

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

      <ShareLinks storeId={store.id} links={links} canShare={Boolean(access && canEdit(access.role))} hasScan={Boolean(lastComplete)} />

      <h2>Weekly report</h2>
      {weekly ? (
        <div className="card">
          <p className="muted">
            {formatDate(weekly.summary.fromDate)} → {formatDate(weekly.summary.toDate)} · {weekly.summary.open} open findings now
          </p>
          <h3 className="status-connected">Fixed ({weekly.summary.fixed.length})</h3>
          {titleList(weekly.summary.fixed)}
          <h3>New ({weekly.summary.added.length})</h3>
          {titleList(weekly.summary.added)}
          <h3 className="error">Came back ({weekly.summary.recurred.length})</h3>
          {titleList(weekly.summary.recurred)}
        </div>
      ) : (
        <p className="muted">The weekly report needs at least two complete scans. Scheduled scans run once a week.</p>
      )}

      <h2>Scan history</h2>
      {scans.length === 0 ? (
        <p className="muted">No scans yet.</p>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Status</th><th>By</th><th className="num">Products</th><th className="num">Critical</th><th className="num">Warnings</th><th className="num">Low</th>
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
                    <td>{s.trigger === "scheduled" ? "Schedule" : "You"}</td>
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
