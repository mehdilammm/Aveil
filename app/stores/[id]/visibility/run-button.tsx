"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { useJob } from "@/components/job-progress";

export function RunVisibilityButton({ storeId, disabledReason, openJobId = null }: { storeId: string; disabledReason: string | null; openJobId?: string | null }) {
  const t = useTranslations("visibilityRun");
  const running = useRef(false);
  const [jobId, setJobId] = useState<string | null>(openJobId);
  const [error, setError] = useState<string | null>(null);
  const job = useJob(jobId);
  const active = Boolean(jobId) && (!job || job.status === "queued" || job.status === "running");

  async function run() {
    if (running.current || active) return;
    running.current = true;
    setError(null);
    try {
      const res = await fetch(`/api/stores/${storeId}/visibility`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (body.jobId) setJobId(body.jobId);
      else if (body.error) setError(body.error);
    } catch {
      setError(t("network"));
    } finally {
      running.current = false;
    }
  }

  return (
    <div>
      <button onClick={run} disabled={active || Boolean(disabledReason)} aria-busy={active}>{active ? t("running") : t("run")}</button>
      {active && <p className="muted small" role="status">{job?.status === "running" ? t("asking") : t("queued")} {t("leave")}</p>}
      {job?.status === "failed" && <p className="error">{job.error ?? t("failed")}</p>}
      {disabledReason && <p className="muted small">{disabledReason}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// Workspace owner only: re-run now with Google Search grounding (skips the weekly wait; grounding caps still apply).
export function TestRunButton({ storeId }: { storeId: string }) {
  const t = useTranslations("visibilityRun");
  const running = useRef(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const job = useJob(jobId);
  const active = Boolean(jobId) && (!job || job.status === "queued" || job.status === "running");

  async function run() {
    if (running.current || active) return;
    running.current = true;
    setMessage(null);
    try {
      const res = await fetch(`/api/stores/${storeId}/visibility`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test: true }) });
      const body = await res.json().catch(() => ({}));
      if (body.jobId) setJobId(body.jobId);
      else setMessage(body.error ?? null);
    } catch {
      setMessage(t("network"));
    } finally {
      running.current = false;
    }
  }

  return (
    <div>
      <button className="secondary" onClick={run} disabled={active} aria-busy={active}>{active ? t("testRunning") : t("testRun")}</button>
      <p className="muted small">{t("testNote")}</p>
      {job?.status === "succeeded" && <p className="small">{t("testDone")}</p>}
      {job?.status === "failed" && <p className="error">{job.error ?? t("failed")}</p>}
      {message && <p className="small">{message}</p>}
    </div>
  );
}

export function RereadButton({ storeId, count }: { storeId: string; count: number }) {
  const router = useRouter();
  const t = useTranslations("visibilityRun");
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/stores/${storeId}/visibility/reread`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      setMessage(body.error ?? t("reread", { n: Number(body.updated ?? 0) }));
      router.refresh();
    } catch {
      setMessage(t("network"));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button className="secondary" onClick={run} disabled={busy} aria-busy={busy}>
        {busy ? t("rereading") : t("rereadCta", { n: count })}
      </button>
      <p className="muted small">{t("rereadNote")}</p>
      {message && <p className="muted">{message}</p>}
    </div>
  );
}
