"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useJob } from "@/components/job-progress";

export function VerifyButton({ storeId, findingKey, openJobId = null }: { storeId: string; findingKey: string; openJobId?: string | null }) {
  const t = useTranslations("verify");
  const [jobId, setJobId] = useState<string | null>(openJobId);
  const [error, setError] = useState<string | null>(null);
  const job = useJob(jobId);
  const active = Boolean(jobId) && (!job || job.status === "queued" || job.status === "running");
  async function run() {
    setError(null);
    try {
      const res = await fetch(`/api/stores/${storeId}/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ finding_key: findingKey }) });
      const body = await res.json().catch(() => ({}));
      if (body.jobId) setJobId(body.jobId);
      else setError(body.error ?? t("failed"));
    } catch {
      setError(t("failed"));
    }
  }
  return (
    <div className="row small">
      <button type="button" className="secondary" onClick={run} disabled={active}>{active ? t("checking") : t("verify")}</button>
      {active && <span className="muted">{t("checkingNote")}</span>}
      {job?.status === "failed" && <span className="error">{job.error ?? t("failed")}</span>}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
