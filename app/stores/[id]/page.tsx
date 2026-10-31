import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { formatDate } from "@/components/badges";
import { FunnelChart } from "@/components/charts";
import { AREA_ICON, Icon } from "@/components/icons";
import { IssuesChart } from "@/components/issues-chart";
import { TopFixes } from "@/components/top-fixes";
import { EmptyState, HeroAction, PageHead, StatStrip } from "@/components/ui";
import { areaOf, AREAS } from "@/lib/categories";
import { getStore, listScans, sortForFixing, openJobId } from "@/lib/data";
import { groupByType, plainSentence } from "@/lib/finding-groups";
import { loadFunnel } from "@/lib/funnel-data";
import { PluginOnboarding } from "@/components/plugin-onboarding";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { RunScanButton } from "./run-scan-button";
import { OwnershipCard } from "@/components/ownership-card";
import { AlertBanner } from "@/components/alert-banner";
import { FirstOrderBanner } from "@/components/first-order-banner";
import { canEdit, storeAccess } from "@/lib/workspace";

const WEEK_MS = 7 * 86_400_000;

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const { id } = await params;
  const { supabase, user } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const t = await getTranslations("overview");
  const ta = await getTranslations("areas");
  const tf = await getTranslations("funnelUi");
  const tp = await getTranslations("plain");
  const scanJobId = await openJobId(supabase, store.id, "scan");
  const access = user ? await storeAccess(supabase, user.id, store.id) : null;

  // Stores in the app are WooCommerce stores: show how to install the traffic plugin until it is connected.
  let pluginConnected = true;
  try {
    const { data } = await createAdminClient().from("traffic_connectors").select("store_id").eq("store_id", store.id).maybeSingle();
    pluginConnected = Boolean(data);
  } catch {
    pluginConnected = true; // unknown: do not nag
  }

  const scans = await listScans(supabase, id, 20);
  const last = scans[0];
  const funnel = await loadFunnel(supabase, id);
  const { lastComplete } = funnel;
  const findings = sortForFixing(funnel.findings);
  const since = new Date(Date.now() - WEEK_MS).toISOString();
  const { count: fixedWeek } = await supabase.from("fix_audit_log").select("id", { count: "exact", head: true }).eq("store_id", id).in("status", ["applied", "reapplied"]).gte("applied_at", since);
  const areas = AREAS.map((a) => {
    const inArea = findings.filter((f) => areaOf(f) === a.key);
    return { ...a, total: inArea.length, high: inArea.filter((f) => f.severity === "high").length, medium: inArea.filter((f) => f.severity === "medium").length, low: inArea.filter((f) => f.severity === "low").length, unavailable: inArea.filter((f) => f.basis === "unavailable").length };
  });
  const critical = findings.filter((f) => f.severity === "high").length;
  // Identical findings are one fix ("Brand missing on 15 products"); ones that could not be checked are not a next step.
  const groups = groupByType(findings.filter((f) => f.basis !== "unavailable"));
  const next = groups[0];
  const status = ["connected", "error", "not-connected"].includes(store.connection_status) ? store.connection_status : "not-connected";

  return (
    <>
      <PageHead
        title={store.name}
        sub={<><bdi>{store.url}</bdi> · <span className={`status-${status}`}>{t(`status.${status}`)}</span></>}
        action={last ? <RunScanButton storeId={store.id} openJobId={scanJobId} label={t("rescan")} /> : undefined}
      />
      {store.connection_status === "error" && store.connection_error && <p className="error">{store.connection_error}</p>}
      <AlertBanner storeId={store.id} />
      <FirstOrderBanner storeId={store.id} />

      {!last ? (
        <EmptyState icon="search" title={t("noScanTitle")} text={t("noScan")} action={<RunScanButton storeId={store.id} openJobId={scanJobId} label={t("firstScan")} />} />
      ) : (
        <>
          {next ? (
            <HeroAction eyebrow={t("nextAction")} title={plainSentence(tp, next)} href={`/stores/${store.id}/fix#g-${next.type}`} cta={t("fixIt")} />
          ) : lastComplete ? (
            <HeroAction done eyebrow={t("nextAction")} title={t("allClearTitle")} text={t("allClear")} />
          ) : null}

          {groups.length > 1 && (
            <>
              <h2 className="section-title"><Icon name="fix" /> {t("topTitle", { n: Math.min(5, groups.length) })}</h2>
              <TopFixes groups={groups.slice(0, 5)} storeId={store.id} />
              {findings.length > 0 && <p><Link className="button secondary" href={`/stores/${store.id}/fix`}>{t("seeAll", { n: findings.length })}</Link></p>}
            </>
          )}

          {lastComplete && (
            <StatStrip
              stats={[
                { label: t("statOpen"), value: findings.length, basis: "observed", foot: t("statFrom", { date: formatDate(lastComplete.finished_at, locale) }) },
                { label: t("statCritical"), value: critical, tone: critical ? "bad" : "good", basis: "observed" },
                { label: t("statFixed"), value: fixedWeek ?? 0, tone: fixedWeek ? "good" : undefined, basis: "observed" },
                { label: t("statProducts"), value: lastComplete.scanned_products ?? 0, basis: "observed" },
              ]}
            />
          )}
          {last.status === "failed" && last.error && <p className="error">{last.error}</p>}

          {lastComplete && (
            <>
              <h2 className="section-title"><Icon name="revenue" /> {t("funnelTitle")}</h2>
              <div className="card">
                <FunnelChart steps={funnel.stages.map((s) => ({ key: s.key, question: tf(`q.${s.key}`), status: s.status, value: s.value, basis: s.basis, statusLabel: tf(`status.${s.status}`), laterLabel: tf("status.later") }))} />
                <p className="small"><Link href={`/stores/${store.id}/revenue`}>{t("funnelMore")}</Link></p>
              </div>

              <IssuesChart supabase={supabase} storeId={store.id} />

              <h2 className="section-title"><Icon name="readiness" /> {t("areasTitle")}</h2>
              <div className="areas">
                {areas.map((a) => (
                  <div key={a.key} className="card area">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <strong className="row"><Icon name={AREA_ICON[a.key]} /> {ta(`${a.key}.label`)}</strong>
                      <span className="area-total">{a.total}</span>
                    </div>
                    <p className="muted small">{ta(`${a.key}.description`)}</p>
                    {a.total > 0 && (
                      <div className="row small">
                        {a.high > 0 && <span className="badge sev-high">{t("nCritical", { n: a.high })}</span>}
                        {a.medium > 0 && <span className="badge sev-medium">{t("nWarning", { n: a.medium })}</span>}
                        {a.low > 0 && <span className="meta">{t("nLow", { n: a.low })}</span>}
                      </div>
                    )}
                    {a.unavailable > 0 && <p className="meta">{t("nUnavailable", { n: a.unavailable })}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {!pluginConnected && (
        <details className="card fold">
          <summary><Icon name="plug" /> {t("pluginTitle")}</summary>
          <PluginOnboarding connected={null} />
        </details>
      )}
      <OwnershipCard supabase={supabase} storeId={store.id} storeUrl={store.url} canEdit={Boolean(access && canEdit(access.role))} />
    </>
  );
}
