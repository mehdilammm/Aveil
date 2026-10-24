import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatDate } from "@/components/badges";
import { FindingCard } from "@/components/finding-card";
import { findingsForScan, getStore, listScans, sortForFixing, openJobId } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { RunScanButton } from "../run-scan-button";
import { VerifyButton } from "./verify-button";
import { AutoFixPanel, FixAction, UndoButton, WriteKeyForm } from "./autofix-ui";
import { BulkApply, CsvImport } from "./bulk-ui";
import { fixFor } from "@/lib/fix-catalog";
import { createAdminClient } from "@/lib/supabase/admin";
import { PlanLock } from "@/components/plan-lock";
import { storePlan } from "@/lib/plan-gate";
import { fixQueue, weightsFrom } from "@/lib/fix-queue";
import { canEdit, storeAccess } from "@/lib/workspace";

export default async function FixCenterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { supabase, user } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const scanJobId = await openJobId(supabase, store.id, "scan");
  const t = await getTranslations("fixCenter");
  const access = user ? await storeAccess(supabase, user.id, store.id) : null;
  const editor = Boolean(access && canEdit(access.role));
  const ta = await getTranslations("autofix");
  const adminDb = createAdminClient();
  const plan = await storePlan(adminDb, store.id);
  const [{ data: setting }, { data: writeKey }, { data: audit }] = await Promise.all([
    adminDb.from("stores").select("auto_fix_enabled, auto_fix_approved_at").eq("id", store.id).maybeSingle(),
    adminDb.from("store_write_credentials").select("key_hint").eq("store_id", store.id).maybeSingle(),
    supabase.from("fix_audit_log").select("id, batch_id, finding_key, kind, status, after, error, verify_status, automatic, applied_at").eq("store_id", store.id).order("applied_at", { ascending: false }).limit(30),
  ]);
  const auditRows = (audit ?? []) as { id: string; batch_id: string; finding_key: string; kind: string; status: string; after: { describe?: string } | null; error: string | null; verify_status: string | null; automatic: boolean; applied_at: string }[];
  // The banner: the latest automatic batch of the last 7 days that still has applied fixes.
  const lastAuto = auditRows.find((r) => r.automatic && r.status === "applied" && Date.now() - Date.parse(r.applied_at) < 7 * 86_400_000);
  const bannerCount = lastAuto ? auditRows.filter((r) => r.batch_id === lastAuto.batch_id && r.status === "applied").length : 0;
  const appliedFor = new Map(auditRows.filter((r) => r.status === "applied").map((r) => [r.finding_key, r]));
  const [{ data: vrows }, { data: rrows }] = await Promise.all([
    supabase.from("finding_verifications").select("finding_key, status, evidence, checked_at, job_id, scan_id").eq("store_id", store.id),
    supabase.from("visibility_rechecks").select("due_on, day, finding_keys, job_id").eq("store_id", store.id).order("due_on"),
  ]);
  const verifications = new Map((vrows ?? []).map((v) => [v.finding_key as string, v as { status: string; evidence: string | null; checked_at: string | null; job_id: string | null }]));
  const jobIds = (rrows ?? []).map((r) => r.job_id).filter(Boolean) as string[];
  const { data: rjobs } = jobIds.length ? await supabase.from("jobs").select("id, status, error").in("id", jobIds) : { data: [] };
  const rechecks = (rrows ?? []).map((r) => ({ ...(r as { due_on: string; day: number; finding_keys: string[]; job_id: string | null }), job: (rjobs ?? []).find((j) => j.id === r.job_id) as { status: string; error: string | null } | undefined }));

  const lastComplete = (await listScans(supabase, id, 20)).find((s) => s.status === "complete");
  const findings = lastComplete ? sortForFixing(await findingsForScan(supabase, lastComplete.id)) : [];
  // Priority queue: (Impact × Confidence) / Effort; high-value products are the scan's sample.
  const { data: sampleRows } = lastComplete ? await supabase.from("scan_schema_pages").select("product_id").eq("scan_id", lastComplete.id) : { data: [] };
  const weights = weightsFrom(query);
  // Verified fixes leave the queue and wait in their own section until the next scan confirms them.
  // Only a re-check of this scan's finding counts; a newer scan starts over.
  const isResolved = (key: string) => { const v = verifications.get(key) as { status: string; scan_id?: string } | undefined; return v?.status === "resolved" && v.scan_id === lastComplete?.id; };
  const queue = fixQueue(findings.filter((f) => !isResolved(f.finding_key)), new Set((sampleRows ?? []).map((r) => Number(r.product_id))), weights);
  const resolvedNow = findings.filter((f) => isResolved(f.finding_key));
  const unavailable = findings.filter((f) => f.basis === "unavailable" && !isResolved(f.finding_key));

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
      <p className="card row" style={{ justifyContent: "space-between" }}>
        <span className="muted">{t("generatorsNote")}</span>
        <span className="row">
          <Link className="button secondary" href={`/stores/${store.id}/fix/generators`}>{t("generatorsLink")}</Link>
          <Link className="button secondary" href={`/stores/${store.id}/fix/descriptions`}>{t("descriptionsLink")}</Link>
        </span>
      </p>
      {lastComplete && findings.length === 0 && <p className="notice">No open findings.</p>}
      {lastAuto && (
        <p className="notice row" style={{ justifyContent: "space-between" }}>
          <span>{ta("banner", { n: bannerCount })}</span>
          {editor && <UndoButton storeId={store.id} batchId={lastAuto.batch_id} />}
        </p>
      )}
      {editor && (plan.autoFix ? <AutoFixPanel storeId={store.id} enabled={Boolean(setting?.auto_fix_enabled)} approvedAt={setting?.auto_fix_approved_at ?? null} /> : <PlanLock feature="autoFix" />)}
      {editor && <WriteKeyForm storeId={store.id} hint={writeKey?.key_hint ?? null} />}
      {editor && lastComplete && <BulkApply storeId={store.id} />}
      {editor && <CsvImport storeId={store.id} canWrite={Boolean(writeKey)} />}
      {findings.length > 0 && (
        <details className="card">
          <summary className="small">{t("formula")}</summary>
          <form className="row small" style={{ flexWrap: "wrap", gap: 8 }}>
            {(["w_high", "w_medium", "w_low", "w_store", "w_heuristic"] as const).map((k) => (
              <label key={k} className="small">{t(k)} <input name={k} type="number" step="0.5" min="0" max="10" defaultValue={String(k === "w_high" ? weights.severity.high : k === "w_medium" ? weights.severity.medium : k === "w_low" ? weights.severity.low : k === "w_store" ? weights.storeWide : weights.confidence.heuristic)} style={{ width: 70 }} /></label>
            ))}
            <button className="secondary">{t("apply")}</button>
          </form>
          <p className="muted small">{t("formulaNote")}</p>
        </details>
      )}
      {(["store", "high_value", "product"] as const).map((g) => {
        const items = queue.filter((q) => q.group === g);
        if (!items.length) return null;
        return (
          <section key={g}>
            <h2>{t(`g_${g}`)} ({items.length})</h2>
            {items.map((item) => {
              const f = item.finding;
              const v = verifications.get(f.finding_key);
              return (
                <FindingCard key={f.finding_key} finding={f} storeUrl={store.url}>
                  {item && <p className="small muted">{t("score", { score: item.score, impact: item.impact, confidence: item.confidence, effort: item.effort })}</p>}
                  {v && v.status !== "running" && (
                    <p className="small">
                      <span className={`badge ${v.status === "resolved" ? "state-resolved" : v.status === "still_open" ? "sev-medium" : "basis-unavailable"}`}>{t(`v_${v.status}`)}</span>{" "}
                      {v.checked_at ? t("checkedAt", { date: formatDate(v.checked_at) }) : ""} {v.evidence}
                    </p>
                  )}
                  {appliedFor.get(f.finding_key) ? (
                    <p className="small"><span className="badge basis-observed">{appliedFor.get(f.finding_key)!.automatic ? ta("chipAuto") : ta("chipOneClick")}</span> {appliedFor.get(f.finding_key)!.after?.describe} {editor && <UndoButton storeId={store.id} auditId={appliedFor.get(f.finding_key)!.id} />}</p>
                  ) : editor && (() => {
                    const spec = fixFor(f);
                    return <FixAction storeId={store.id} findingKey={f.finding_key} type={spec.type} kind={spec.kind} field={spec.field} canWrite={Boolean(writeKey)} />;
                  })()}
                  {editor && f.basis !== "unavailable" && <VerifyButton storeId={store.id} findingKey={f.finding_key} openJobId={v?.status === "running" ? v.job_id : null} />}
                </FindingCard>
              );
            })}
          </section>
        );
      })}
      {unavailable.length > 0 && (
        <section>
          <h2>{t("g_check")} ({unavailable.length})</h2>
          <p className="muted small">{t("checkNote")}</p>
          {unavailable.map((f) => <FindingCard key={f.finding_key} finding={f} storeUrl={store.url} />)}
        </section>
      )}

      {resolvedNow.length > 0 && (
        <section>
          <h2>{t("g_resolved")} ({resolvedNow.length})</h2>
          {resolvedNow.map((f) => {
            const v = verifications.get(f.finding_key)!;
            return (
              <FindingCard key={f.finding_key} finding={f} storeUrl={store.url} resolvedLabel={t("v_resolved")}>
                <p className="small">{v.checked_at ? t("checkedAt", { date: formatDate(v.checked_at) }) : ""} {v.evidence}</p>
              </FindingCard>
            );
          })}
        </section>
      )}

      {auditRows.length > 0 && (
        <>
          <h2>{ta("auditTitle")}</h2>
          <div className="card table-wrap">
            <table>
              <thead><tr><th colSpan={4} className="muted small">{ta("auditCols")}</th></tr></thead>
              <tbody>
                {auditRows.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.applied_at)}</td>
                    <td style={{ whiteSpace: "normal" }}>{r.after?.describe ?? r.kind}{r.error ? ` · ${r.error}` : ""}</td>
                    <td>{r.automatic ? ta("byAuto") : ta("byYou")}</td>
                    <td>{r.status === "reverted" ? ta("reverted") : r.status === "failed" ? ta("failedRow") : r.verify_status ? ta(`v_${r.verify_status}`) : ""} {editor && r.status === "applied" && <UndoButton storeId={store.id} auditId={r.id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {rechecks.length > 0 && (
        <>
          <h2>{t("rechecksTitle")}</h2>
          <div className="card">
            <p className="muted small">{t("rechecksNote")}</p>
            <ul className="small">
              {rechecks.map((r) => (
                <li key={r.due_on}>
                  {t("recheckRow", { day: r.day, date: r.due_on, n: r.finding_keys.length })} · {r.job?.status === "succeeded" ? <Link href={`/stores/${store.id}/visibility`}>{t("recheckDone")}</Link> : r.job?.status === "failed" ? `${t("recheckFailed")} ${r.job.error ?? ""}` : t("recheckPending")}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
