import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatDate } from "@/components/badges";
import { FindingCard } from "@/components/finding-card";
import { findingsForScan, getStore, listScans, sortForFixing, openJobId } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { RunScanButton } from "../run-scan-button";
import { VerifyButton } from "./verify-button";
import { canEdit, storeAccess } from "@/lib/workspace";

export default async function FixCenterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const scanJobId = await openJobId(supabase, store.id, "scan");
  const t = await getTranslations("fixCenter");
  const access = user ? await storeAccess(supabase, user.id, store.id) : null;
  const editor = Boolean(access && canEdit(access.role));
  const [{ data: vrows }, { data: rrows }] = await Promise.all([
    supabase.from("finding_verifications").select("finding_key, status, evidence, checked_at, job_id").eq("store_id", store.id),
    supabase.from("visibility_rechecks").select("due_on, day, finding_keys, job_id").eq("store_id", store.id).order("due_on"),
  ]);
  const verifications = new Map((vrows ?? []).map((v) => [v.finding_key as string, v as { status: string; evidence: string | null; checked_at: string | null; job_id: string | null }]));
  const jobIds = (rrows ?? []).map((r) => r.job_id).filter(Boolean) as string[];
  const { data: rjobs } = jobIds.length ? await supabase.from("jobs").select("id, status, error").in("id", jobIds) : { data: [] };
  const rechecks = (rrows ?? []).map((r) => ({ ...(r as { due_on: string; day: number; finding_keys: string[]; job_id: string | null }), job: (rjobs ?? []).find((j) => j.id === r.job_id) as { status: string; error: string | null } | undefined }));

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
      <p className="card row" style={{ justifyContent: "space-between" }}>
        <span className="muted">{t("generatorsNote")}</span>
        <span className="row">
          <Link className="button secondary" href={`/stores/${store.id}/fix/generators`}>{t("generatorsLink")}</Link>
          <Link className="button secondary" href={`/stores/${store.id}/fix/descriptions`}>{t("descriptionsLink")}</Link>
        </span>
      </p>
      {lastComplete && findings.length === 0 && <p className="notice">No open findings.</p>}
      {findings.map((f) => {
        const v = verifications.get(f.finding_key);
        return (
          <FindingCard key={f.finding_key} finding={f} storeUrl={store.url}>
            {v && v.status !== "running" && (
              <p className="small">
                <span className={`badge ${v.status === "resolved" ? "state-resolved" : v.status === "still_open" ? "sev-medium" : "basis-unavailable"}`}>{t(`v_${v.status}`)}</span>{" "}
                {v.checked_at ? t("checkedAt", { date: formatDate(v.checked_at) }) : ""} {v.evidence}
              </p>
            )}
            {editor && f.basis !== "unavailable" && <VerifyButton storeId={store.id} findingKey={f.finding_key} openJobId={v?.status === "running" ? v.job_id : null} />}
          </FindingCard>
        );
      })}

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
