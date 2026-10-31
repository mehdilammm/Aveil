import type { SupabaseClient } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";
import { BasisBadge } from "./badges";
import { LineChart } from "./charts";
import { EmptyState } from "./ui";

// Open issues after each complete scan (scans.findings_count), with the days fixes were applied (fix_audit_log).
export async function IssuesChart({ supabase, storeId }: { supabase: SupabaseClient; storeId: string }) {
  const t = await getTranslations("charts");
  const [{ data: scans }, { data: fixes }] = await Promise.all([
    supabase.from("scans").select("finished_at, findings_count").eq("store_id", storeId).eq("status", "complete").not("findings_count", "is", null).order("finished_at", { ascending: false }).limit(30),
    supabase.from("fix_audit_log").select("applied_at, status").eq("store_id", storeId).in("status", ["applied", "reapplied", "reverted"]).order("applied_at", { ascending: false }).limit(200),
  ]);
  const points = (scans ?? []).filter((s) => s.finished_at).map((s) => ({ at: String(s.finished_at), value: Number(s.findings_count) }));
  if (points.length < 2) return <EmptyState icon="readiness" title={t("issuesEmptyTitle")} text={t("issuesEmpty")} />;
  const sorted = [...points].sort((a, b) => a.at.localeCompare(b.at));
  const byDay = new Map<string, number>();
  for (const f of fixes ?? []) byDay.set(String(f.applied_at).slice(0, 10), (byDay.get(String(f.applied_at).slice(0, 10)) ?? 0) + 1);
  const marks = [...byDay.entries()].map(([day, n]) => ({ at: `${day}T12:00:00Z`, label: t("fixMark", { n, day }) }));
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{t("issuesTitle")}</strong>
        <span className="small muted"><BasisBadge basis="observed" /> {t("issuesFromTo", { from: sorted[0].value, to: sorted[sorted.length - 1].value, n: sorted.length })}</span>
      </div>
      <LineChart points={sorted} marks={marks} label={t("issuesAria", { from: sorted[0].value, to: sorted[sorted.length - 1].value })} valueLabel={(p) => t("issuesPoint", { n: p.value, day: p.at.slice(0, 10) })} />
      <div className="chart-legend"><span><i style={{ background: "var(--emerald)" }} />{t("issuesLegend")}</span><span><i style={{ background: "transparent", borderInlineStart: "2px dashed var(--emerald-bright)" }} />{t("fixesLegend")}</span></div>
    </div>
  );
}
