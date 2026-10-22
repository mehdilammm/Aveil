"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { useJob } from "@/components/job-progress";

export function RunScanButton({ storeId, label, openJobId = null }: { storeId: string; label?: string; openJobId?: string | null }) {
  const t = useTranslations("scan");
  const running = useRef(false);
  const [jobId, setJobId] = useState<string | null>(openJobId);
  const [error, setError] = useState<string | null>(null);
  const job = useJob(jobId);
  const active = Boolean(jobId) && (!job || job.status === "queued" || job.status === "running");

  async function run() {
    // The ref blocks a second click that lands before React re-renders the disabled button.
    if (running.current || active) return;
    running.current = true;
    setError(null);
    try {
      const res = await fetch(`/api/stores/${storeId}/scan`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (body.jobId) setJobId(body.jobId);
      else if (body.error) setError(body.error);
    } catch {
      setError(t("network"));
    } finally {
      running.current = false;
    }
  }

  const p = job?.progress ?? {};
  const stepText =
    p.step === "products" ? t("stepProducts", { page: Number(p.page ?? 1) })
    : p.step === "store" ? t("stepStore")
    : p.step === "product pages" ? t("stepPages", { checked: Number(p.checked ?? 0), of: Number(p.of ?? 0) })
    : p.step === "done" ? t("stepDone")
    : t("queued");

  return (
    <div>
      <button onClick={run} disabled={active} aria-busy={active}>{active ? t("running") : label ?? t("run")}</button>
      {active && <p className="muted small" role="status">{stepText}{job && job.attempt > 1 ? ` · ${t("retry", { attempt: job.attempt, max: job.max_attempts })}` : ""} {t("leave")}</p>}
      {job?.status === "failed" && <p className="error">{job.error ?? t("failed")}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
