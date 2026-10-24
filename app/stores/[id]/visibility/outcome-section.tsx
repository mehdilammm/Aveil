import { getTranslations } from "next-intl/server";
import { BasisBadge, formatDate } from "@/components/badges";
import { getUser } from "@/lib/supabase/server";
import { visibilityOutcomes, type OutcomeRecheck, type OutcomeResult } from "@/lib/visibility-outcome";

// "After your fixes" (G5): answers before a verified fix vs. the 7 / 14 / 30-day re-checks.
export async function OutcomeSection({ storeId }: { storeId: string }) {
  const t = await getTranslations("outcome");
  const { supabase } = await getUser();
  const { data: rows } = await supabase.from("visibility_rechecks").select("due_on, day, finding_keys, job_id").eq("store_id", storeId).order("due_on").limit(60);
  if (!rows?.length) return null;
  const jobIds = rows.map((r) => r.job_id).filter((x): x is string => Boolean(x));
  const [{ data: jobs }, { data: ver }, { data: runs }] = await Promise.all([
    jobIds.length ? supabase.from("jobs").select("id, status, error, progress").in("id", jobIds) : Promise.resolve({ data: [] as { id: string; status: string; error: string | null; progress: Record<string, unknown> | null }[] }),
    supabase.from("finding_verifications").select("finding_key, checked_at").eq("store_id", storeId).not("checked_at", "is", null),
    supabase.from("visibility_runs").select("id, status, created_at").eq("store_id", storeId).eq("status", "complete").order("created_at", { ascending: false }).limit(200),
  ]);
  const rechecks: OutcomeRecheck[] = rows.map((r) => {
    const j = (jobs ?? []).find((x) => x.id === r.job_id);
    return { due_on: r.due_on, day: r.day, finding_keys: r.finding_keys ?? [], job: j ? { status: j.status, error: j.error, run_id: typeof j.progress?.run_id === "string" ? j.progress.run_id : null } : null };
  });
  const checkedAt = new Map((ver ?? []).map((v) => [v.finding_key as string, v.checked_at as string]));
  // Results only for the runs the comparison can use: each re-check's run and the last run before its fix.
  const draft = visibilityOutcomes(rechecks, runs ?? [], [], checkedAt);
  const needed = new Set<string>();
  for (const r of rechecks) if (r.job?.run_id) needed.add(r.job.run_id);
  for (const o of draft) {
    const before = (runs ?? []).find((x) => x.created_at < o.fixedAt);
    if (before) needed.add(before.id);
  }
  const { data: res } = needed.size ? await supabase.from("visibility_results").select("run_id, prompt_id, prompt, engine, mentioned, error").in("run_id", [...needed]) : { data: [] };
  const outcomes = visibilityOutcomes(rechecks, runs ?? [], (res ?? []) as OutcomeResult[], checkedAt);

  return (
    <>
      <h2>{t("title")}</h2>
      <p className="muted small">{t("note")}</p>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>{t("fixed")}</th><th>{t("recheck")}</th><th>{t("before")}</th><th>{t("after")}</th><th>{t("changes")}</th></tr>
          </thead>
          <tbody>
            {outcomes.map((o) => (
              <tr key={o.due_on}>
                <td>{formatDate(o.fixedAt)}<div className="muted small">{t("fixes", { n: o.fixes })}</div></td>
                <td>{t("day", { day: o.day })}<div className="muted small">{o.due_on}</div></td>
                {o.state === "done" ? (
                  <>
                    <td>{t("named", { named: o.before!.named, total: o.before!.answered })}<div className="muted small">{formatDate(o.before!.at)}</div></td>
                    <td><BasisBadge basis="observed" /> {t("named", { named: o.after!.named, total: o.after!.answered })}<div className="muted small">{formatDate(o.after!.at)}</div></td>
                    <td className="small">
                      {o.gained.length === 0 && o.lost.length === 0 && <span className="muted">{t("noChange")}</span>}
                      {o.gained.length > 0 && <div className="status-connected">{t("gained", { n: o.gained.length })}: {o.gained.slice(0, 3).join(" · ")}</div>}
                      {o.lost.length > 0 && <div className="error">{t("lost", { n: o.lost.length })}: {o.lost.slice(0, 3).join(" · ")}</div>}
                    </td>
                  </>
                ) : (
                  <td colSpan={3}>
                    <BasisBadge basis="unavailable" />{" "}
                    {o.state === "pending" ? t("pending", { date: o.due_on }) : o.state === "failed" ? `${t("failed")} ${o.reason ?? ""}` : o.state === "no_baseline" ? t("noBaseline") : t("noOverlap")}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
