import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { formatDate } from "@/components/badges";
import { EmptyState, PageHead, StatStrip } from "@/components/ui";
import { deltasForScans, getStore, listScans, weeklyReport } from "@/lib/data";
import { shareState } from "@/lib/share-report";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";
import { ShareLinks } from "./share-links";
import { PlanLock } from "@/components/plan-lock";
import { workspacePlan } from "@/lib/plan-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function ReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const { id } = await params;
  const { supabase, user } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const t = await getTranslations("reports");

  const scans = await listScans(supabase, id, 50);
  const deltas = await deltasForScans(supabase, scans);
  const lastComplete = scans.find((s) => s.status === "complete");
  const weekly = await weeklyReport(supabase, scans);
  const access = user ? await storeAccess(supabase, user.id, store.id) : null;
  const plan = access ? await workspacePlan(createAdminClient(), access.workspace_id) : null;
  const { data: shareRows } = await supabase.from("share_reports").select("id, created_at, expires_at, revoked_at, views").eq("store_id", store.id).order("created_at", { ascending: false }).limit(50);
  const now = Date.now();
  const links = (shareRows ?? []).map((r) => ({ ...r, state: shareState(r, now) as "ok" | "expired" | "revoked" }));
  // Same titles grouped with a count ("Feed: brand missing × 15") instead of one line each.
  const titleList = (keys: string[]) => {
    if (!keys.length) return <p className="muted">{t("none")}</p>;
    const counts = new Map<string, number>();
    for (const k of keys) { const title = weekly?.titles.get(k) ?? k; counts.set(title, (counts.get(title) ?? 0) + 1); }
    return <ul>{[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([title, n]) => <li key={title}>{title}{n > 1 ? <span className="meta"> × {n}</span> : null}</li>)}</ul>;
  };

  return (
    <>
      <PageHead title={t("title")} icon="report" sub={t("sub")} action={lastComplete ? <a className="button" href={`/api/stores/${store.id}/report.csv`} download>{t("csv")}</a> : undefined} />
      {weekly && (
        <StatStrip
          stats={[
            { label: t("statFixed"), value: weekly.summary.fixed.length, tone: weekly.summary.fixed.length ? "good" : undefined, basis: "observed" },
            { label: t("statNew"), value: weekly.summary.added.length, tone: weekly.summary.added.length ? "warn" : undefined, basis: "observed" },
            { label: t("statBack"), value: weekly.summary.recurred.length, tone: weekly.summary.recurred.length ? "bad" : undefined, basis: "observed" },
            { label: t("statOpen"), value: weekly.summary.open, basis: "observed" },
          ]}
        />
      )}

      {plan?.shareReports ? <ShareLinks storeId={store.id} links={links} canShare={Boolean(access && canEdit(access.role))} hasScan={Boolean(lastComplete)} /> : <PlanLock feature="shareReports" />}

      <h2>{t("weekly")}</h2>
      {!plan?.shareReports ? (
        <PlanLock feature="shareReports" />
      ) : weekly ? (
        <div className="card">
          <p className="muted">
            {formatDate(weekly.summary.fromDate, locale)} → {formatDate(weekly.summary.toDate, locale)}
          </p>
          <details className="fold" open><summary className="status-connected">{t("fixed", { n: weekly.summary.fixed.length })}</summary>{titleList(weekly.summary.fixed)}</details>
          <details className="fold"><summary>{t("new", { n: weekly.summary.added.length })}</summary>{titleList(weekly.summary.added)}</details>
          <details className="fold"><summary className="error">{t("back", { n: weekly.summary.recurred.length })}</summary>{titleList(weekly.summary.recurred)}</details>
        </div>
      ) : (
        <EmptyState icon="report" title={t("weeklyEmptyTitle")} text={t("weeklyEmpty")} />
      )}

      <h2>{t("history")}</h2>
      {scans.length === 0 ? (
        <EmptyState icon="search" title={t("noScans")} />
      ) : (
        <details className="card fold">
          <summary>{t("historyTable", { n: scans.length })}</summary>
          <div className="table-wrap">
          <table className="rtable">
            <thead>
              <tr>
                <th>{t("date")}</th><th>{t("status")}</th><th>{t("by")}</th><th className="num">{t("products")}</th><th className="num">{t("critical")}</th><th className="num">{t("warnings")}</th><th className="num">{t("low")}</th>
                <th className="num">{t("newCol")}</th><th className="num">{t("resolved")}</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => {
                const c = s.severity_counts ?? {};
                const d = deltas.get(s.id);
                return (
                  <tr key={s.id}>
                    <td data-label={t("date")}>{formatDate(s.finished_at ?? s.started_at, locale)}</td>
                    <td data-label={t("status")} className={s.status === "failed" ? "error" : undefined}>{s.status}</td>
                    <td data-label={t("by")}>{s.trigger === "scheduled" ? t("schedule") : t("you")}</td>
                    <td className="num" data-label={t("products")}>{s.scanned_products ?? "—"}</td>
                    <td className="num" data-label={t("critical")}>{s.status === "complete" ? c.high ?? 0 : "—"}</td>
                    <td className="num" data-label={t("warnings")}>{s.status === "complete" ? c.medium ?? 0 : "—"}</td>
                    <td className="num" data-label={t("low")}>{s.status === "complete" ? c.low ?? 0 : "—"}</td>
                    <td className="num" data-label={t("newCol")}>{d?.new ?? "—"}</td>
                    <td className="num" data-label={t("resolved")}>{d?.resolved ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </details>
      )}
    </>
  );
}
