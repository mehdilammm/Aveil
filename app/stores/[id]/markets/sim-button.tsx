"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { useJob } from "@/components/job-progress";

// F7: starts one agent purchase test for the chosen market and follows it until it ends.
// mode "browser": the real-browser test (no market to choose).
export function SimButton({ storeId, markets, mode = "store_api", openJobId = null, disabled = null }: { storeId: string; markets: { id: string; name: string }[]; mode?: "store_api" | "browser"; openJobId?: string | null; disabled?: string | null }) {
  const t = useTranslations("agentSim");
  const running = useRef(false);
  const [market, setMarket] = useState(markets[0]?.id ?? "");
  const [jobId, setJobId] = useState<string | null>(openJobId);
  const [error, setError] = useState<string | null>(null);
  const job = useJob(jobId);
  const active = Boolean(jobId) && (!job || job.status === "queued" || job.status === "running");

  async function run() {
    if (running.current || active || (mode === "store_api" && !market) || disabled) return;
    running.current = true;
    setError(null);
    try {
      const res = await fetch(`/api/stores/${storeId}/simulate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mode === "browser" ? { mode } : { market }) });
      const body = await res.json().catch(() => ({}));
      if (body.jobId) setJobId(body.jobId);
      else setError(body.error ?? t("failed"));
    } catch {
      setError(t("network"));
    } finally {
      running.current = false;
    }
  }

  return (
    <div className="row">
      {mode === "store_api" && (
        <>
          <label>
            {t("market")}{" "}
            <select value={market} onChange={(e) => setMarket(e.target.value)} disabled={active}>
              {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>{" "}
        </>
      )}
      <button onClick={run} disabled={active || (mode === "store_api" && !market) || Boolean(disabled)} aria-busy={active}>{active ? t("running") : t(mode === "browser" ? "runBrowser" : "run")}</button>
      {disabled && <p className="muted small">{disabled}</p>}
      {active && <p className="muted small" role="status">{job?.status === "running" ? t("running") : t("queued")} {t("leave")}</p>}
      {job?.status === "failed" && <p className="error">{job.error ?? t("failed")}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
