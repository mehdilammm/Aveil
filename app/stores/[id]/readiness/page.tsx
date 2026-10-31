import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { formatDate } from "@/components/badges";
import { IssuesChart } from "@/components/issues-chart";
import { EmptyState, PageHead, StatStrip } from "@/components/ui";
import { deltasForScans, getStore, listScans, openJobId } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { RunScanButton } from "../run-scan-button";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("readiness") };
}

export default async function ReadinessPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const { id } = await params;
  const { supabase } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const t = await getTranslations("readiness");
  const scanJobId = await openJobId(supabase, store.id, "scan");

  const scans = await listScans(supabase, id, 30);
  const deltas = await deltasForScans(supabase, scans);
  const complete = scans.filter((s) => s.status === "complete");
  const last = complete[0];
  const d = last ? deltas.get(last.id) : undefined;

  return (
    <>
      <PageHead title={t("title")} icon="readiness" sub={t("sub")} action={<RunScanButton storeId={store.id} openJobId={scanJobId} />} />
      {last && (
        <StatStrip
          stats={[
            { label: t("statOpen"), value: last.findings_count ?? 0, basis: "observed", foot: formatDate(last.finished_at, locale) },
            { label: t("statResolved"), value: d?.resolved ?? 0, tone: d?.resolved ? "good" : undefined, basis: "observed" },
            { label: t("statNew"), value: d?.new ?? 0, tone: d?.new ? "warn" : undefined, basis: "observed" },
            { label: t("statScans"), value: complete.length, basis: "observed" },
          ]}
        />
      )}
      {scans.length === 0 ? (
        <EmptyState icon="search" title={t("noScansTitle")} text={t("noScans")} action={<RunScanButton storeId={store.id} openJobId={scanJobId} />} />
      ) : (
        <>
          <IssuesChart supabase={supabase} storeId={store.id} />
          <details className="card fold">
          <summary>{t("history")} <span className="meta">{scans.length}</span></summary>
          <div className="table-wrap">
            <table className="rtable">
              <thead>
                <tr>
                  <th>{t("date")}</th><th>{t("status")}</th><th className="num">{t("products")}</th><th className="num">{t("findings")}</th>
                  <th className="num">{t("new")}</th><th className="num">{t("ongoing")}</th><th className="num">{t("recurred")}</th><th className="num">{t("resolved")}</th><th></th>
                </tr>
              </thead>
              <tbody>
                {scans.map((s) => {
                  const x = deltas.get(s.id);
                  return (
                    <tr key={s.id}>
                      <td data-label={t("date")}>{formatDate(s.finished_at ?? s.started_at, locale)}</td>
                      <td data-label={t("status")} className={s.status === "failed" ? "error" : undefined} title={s.error ?? undefined}>{t(`s_${["complete", "failed", "running", "queued"].includes(s.status) ? s.status : "queued"}`)}</td>
                      <td className="num" data-label={t("products")}>{s.scanned_products ?? "—"}</td>
                      <td className="num" data-label={t("findings")}>{s.findings_count ?? "—"}</td>
                      <td className="num" data-label={t("new")}>{x?.new ?? "—"}</td>
                      <td className="num" data-label={t("ongoing")}>{x?.ongoing ?? "—"}</td>
                      <td className="num" data-label={t("recurred")}>{x?.recurred ?? "—"}</td>
                      <td className="num status-connected" data-label={t("resolved")}>{x?.resolved ?? "—"}</td>
                      <td data-label="">{s.status === "complete" && <Link href={`/stores/${store.id}/scans/${s.id}`}>{t("details")}</Link>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </details>
        </>
      )}
      {scans.some((s) => s.status === "failed" && s.error) && (
        <p className="muted">{t("failed")}: {[...new Set(scans.filter((s) => s.status === "failed" && s.error).map((s) => s.error))].join(" · ")}</p>
      )}
    </>
  );
}
