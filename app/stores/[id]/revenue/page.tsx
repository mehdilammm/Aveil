import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BasisBadge, formatDate, SeverityBadge } from "@/components/badges";
import { BarChart, FunnelChart, Legend, weekOf } from "@/components/charts";
import { FirstOrderBanner } from "@/components/first-order-banner";
import { Icon } from "@/components/icons";
import { EmptyState, PageHead, StatStrip, Tech } from "@/components/ui";
import { ORDER_WINDOW_DAYS, revenueByCurrency } from "@/lib/ai-orders";
import { getStore } from "@/lib/data";
import { loadFunnel } from "@/lib/funnel-data";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";
import { RefreshOrders } from "./refresh-orders";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("revenue") };
}

const WEEKS = 13;

export default async function AiRevenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const access = user ? await storeAccess(supabase, user.id, id) : null;
  const t = await getTranslations("revenue");
  const tf = await getTranslations("funnelUi");
  const tc = await getTranslations("charts");
  const tu = await getTranslations("ui");

  const { stages, diagnosis, lastComplete, plan, sync, aiOrders } = await loadFunnel(supabase, id);
  const bySource = new Map<string, { orders: number; revenue: { currency: string; total: number }[] }>();
  for (const s of new Set(aiOrders.map((o) => o.source))) {
    const of = aiOrders.filter((o) => o.source === s);
    bySource.set(s, { orders: of.length, revenue: revenueByCurrency(of) });
  }
  const revenue = revenueByCurrency(aiOrders);
  // Orders per week for the last 13 weeks (Monday-based), from the stored AI-referred orders only.
  const weeks: string[] = [];
  for (let i = WEEKS - 1; i >= 0; i--) weeks.push(weekOf(new Date(Date.now() - i * 7 * 86_400_000).toISOString()));
  const perWeek = weeks.map((w) => aiOrders.filter((o) => weekOf(String(o.ordered_at)) === w).length);
  const ordersMeasured = plan.aiRevenue && sync?.status === "ok";

  return (
    <>
      <PageHead title={t("title")} icon="revenue" sub={t("sub")} />
      <FirstOrderBanner storeId={id} />

      <StatStrip
        stats={[
          ordersMeasured ? { label: t("statOrders", { days: ORDER_WINDOW_DAYS }), value: aiOrders.length, basis: "observed" } : { label: t("statOrders", { days: ORDER_WINDOW_DAYS }), value: "—", basis: "unavailable", foot: !plan.aiRevenue ? t("needsPro") : t("notRead") },
          ordersMeasured ? { label: t("statRevenue"), value: revenue.length ? revenue.map((r) => `${r.total.toFixed(0)} ${r.currency}`).join(" + ") : "0", basis: "observed" } : { label: t("statRevenue"), value: "—", basis: "unavailable" },
          { label: t("statBreak"), value: diagnosis.stage ? stages.findIndex((s) => s.key === diagnosis.stage!.key) + 1 : "—", tone: diagnosis.stage ? "bad" : "good", basis: diagnosis.stage ? diagnosis.stage.basis : "observed", foot: diagnosis.stage ? tf(`q.${diagnosis.stage.key}`) : t("noBreak") },
        ]}
      />

      <h2 className="section-title"><Icon name="revenue" /> {t("funnelTitle")}</h2>
      <div className="card">
        <FunnelChart steps={stages.map((s) => ({ key: s.key, question: tf(`q.${s.key}`), status: s.status, value: s.value, basis: s.basis, statusLabel: tf(`status.${s.status}`) }))} />
        <Tech label={tu("technical")}>
          <ul className="small">{stages.map((s) => <li key={s.key}><strong>{tf(`q.${s.key}`)}</strong> {s.detail}</li>)}</ul>
          <p className="muted small">{t("note", { date: lastComplete ? formatDate(lastComplete.finished_at) : "—" })}</p>
        </Tech>
      </div>

      <h2 className="section-title"><Icon name="alert" /> {t("whyTitle")}</h2>
      {!diagnosis.stage ? (
        <EmptyState icon="check" title={t("noBreakTitle")} text={stages.some((s) => s.status === "unknown") ? t("someUnknown") : t("noBreak")} />
      ) : (
        <div className="card">
          <p>{t("breaksAt", { step: tf(`q.${diagnosis.stage.key}`), value: diagnosis.stage.value })}</p>
          {diagnosis.reasons.length === 0 ? (
            <p className="muted small">{t("noReason")}</p>
          ) : (
            <ol className="reasons">
              {diagnosis.reasons.slice(0, 5).map((r) => (
                <li key={r.finding_key}>
                  <div className="row"><SeverityBadge severity={r.severity} /> <BasisBadge basis={r.basis} /></div>
                  <strong>{r.title}</strong>
                  <p className="small">{tu("howToFix")}: {r.guidance}</p>
                  <Tech label={tu("technical")}><p className="small muted">{r.evidence}</p></Tech>
                </li>
              ))}
            </ol>
          )}
          <p className="row"><Link className="button" href={`/stores/${id}/fix`}>{t("openFix")}</Link> <span className="muted small">{t("noGuarantee")}</span></p>
        </div>
      )}

      <h2 className="section-title"><Icon name="cart" /> {tc("ordersTitle")}</h2>
      {!plan.aiRevenue ? (
        <EmptyState icon="lock" title={t("lockedTitle")} text={t("locked")} action={<Link className="button" href="/pricing">{t("seePlans")}</Link>} />
      ) : !sync ? (
        <EmptyState icon="cart" title={t("notReadTitle")} text={t("notRead")} action={access && canEdit(access.role) ? <RefreshOrders storeId={id} /> : undefined} />
      ) : sync.status !== "ok" ? (
        <div className="card"><p><BasisBadge basis="unavailable" /> {sync.reason}</p>{access && canEdit(access.role) && <RefreshOrders storeId={id} />}</div>
      ) : aiOrders.length === 0 ? (
        <EmptyState icon="cart" title={tc("ordersEmptyTitle")} text={t("noOrders", { days: ORDER_WINDOW_DAYS, n: sync.orders_scanned })} action={access && canEdit(access.role) ? <RefreshOrders storeId={id} /> : undefined} />
      ) : (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}><strong>{tc("ordersTitle")}</strong> <BasisBadge basis="observed" /></div>
          <BarChart periods={weeks} series={[{ name: tc("ordersLegend"), className: "bar-a", values: perWeek }]} label={tc("ordersTitle")} />
          <Legend items={[{ name: tc("ordersLegend"), color: "var(--emerald)" }]} />
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>{t("source")}</th><th className="num">{t("orders")}</th><th className="num">{t("netRevenue")}</th></tr></thead>
              <tbody>
                {[...bySource.entries()].map(([s, v]) => (
                  <tr key={s}><td data-label={t("source")}>{s}</td><td className="num" data-label={t("orders")}>{v.orders}</td><td className="num" data-label={t("netRevenue")}>{v.revenue.map((r) => `${r.total.toFixed(2)} ${r.currency}`).join(" + ")}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="fold">
            <summary>{t("orderList")}</summary>
            <div className="table-wrap">
              <table className="rtable">
                <thead><tr><th>{t("order")}</th><th>{t("date")}</th><th>{t("source")}</th><th>{t("matchedBy")}</th><th>{t("entry")}</th><th className="num">{t("total")}</th><th className="num">{t("refunded")}</th></tr></thead>
                <tbody>
                  {aiOrders.map((o) => (
                    <tr key={o.order_id}><td data-label={t("order")}>#{o.order_id}</td><td data-label={t("date")}>{String(o.ordered_at).slice(0, 10)}</td><td data-label={t("source")}>{o.source}{o.agent_checkout ? ` (${t("agentCheckout")})` : ""}</td><td data-label={t("matchedBy")}>{o.via}</td><td data-label={t("entry")}>{o.entry_path ?? "—"}</td><td className="num" data-label={t("total")}>{o.total.toFixed(2)} {o.currency}</td><td className="num" data-label={t("refunded")}>{o.refunded > 0 ? `${o.refunded.toFixed(2)} ${o.currency}` : "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {access && canEdit(access.role) && <RefreshOrders storeId={id} />}
        </div>
      )}
      {plan.aiRevenue && (
        <p className="muted small">
          {sync?.status === "ok" && sync.agent_checkouts > 0 ? t("agentCheckouts", { n: sync.agent_checkouts }) : t("agentCheckoutNone")}
          {sync && <> · {t("lastRead", { date: formatDate(sync.synced_at) })}</>}
        </p>
      )}
    </>
  );
}
