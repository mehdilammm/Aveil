import Link from "next/link";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { splitCheckerRows } from "@/lib/traffic";
import { BotIdentity } from "@/components/bot-identity";
import { getTranslations } from "next-intl/server";
import { PlanLock } from "@/components/plan-lock";
import { storePlan } from "@/lib/plan-gate";
import { BasisBadge, formatDate } from "@/components/badges";
import { BarChart, daysBetween, Legend } from "@/components/charts";
import { EmptyState, PageHead, StatStrip } from "@/components/ui";

const DAYS = 30;

type Row = { day: string; source: string; category: string; confidence: string; route: string; http_status: number; hits: number };

function sumBy(rows: Row[], key: (r: Row) => string) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.hits);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export default async function AiTrafficPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const t = await getTranslations("traffic");
  const tc = await getTranslations("charts");

  let connector: { last_ingest_at: string | null } | null = null;
  try {
    const { data } = await createAdminClient().from("traffic_connectors").select("last_ingest_at").eq("store_id", store.id).maybeSingle();
    connector = data;
  } catch {
    connector = null;
  }

  const since = new Date(Date.now() - (DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const all: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("traffic_daily")
      .select("day, source, category, confidence, route, http_status, hits")
      .eq("store_id", store.id)
      .gte("day", since)
      .range(from, from + 999);
    all.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }

  const head = <PageHead title={t("title")} icon="traffic" sub={t("sub", { days: DAYS })} />;

  if (!(await storePlan(createAdminClient(), store.id)).botTraffic) return <>{head}<PlanLock feature="botTraffic" note={t("lockedNote")} /></>;

  // Bursts the plugin marked as likely checker tools are shown apart, never in the main numbers.
  const { main: rows, checker } = splitCheckerRows(all.filter((r) => r.hits > 0));
  const checkerTotal = checker.reduce((n, r) => n + r.hits, 0);

  if (!connector && all.length === 0) {
    return (
      <>
        {head}
        <EmptyState icon="plug" title={t("notConnectedTitle")} text={t("notConnected")} action={<Link className="button" href="/settings">{t("openSettings")}</Link>} />
      </>
    );
  }

  const total = rows.reduce((n, r) => n + r.hits, 0);
  const bySource = sumBy(rows, (r) => `${r.source}|${r.category}|${r.confidence}`);
  const byRoute = sumBy(rows, (r) => `${r.route}|${r.http_status}`).slice(0, 15);
  const byDay = sumBy(rows, (r) => r.day).sort((a, b) => b[0].localeCompare(a[0]));
  // Bot visits per day: claimed by user agent (plugin totals) and verified by IP (bot_hits), last 30 days.
  const days = daysBetween(new Date(Date.now() - (DAYS - 1) * 86_400_000), new Date());
  const botRows = rows.filter((r) => r.category !== "human-ai-referral");
  const claimed = days.map((d) => botRows.filter((r) => r.day === d).reduce((n, r) => n + r.hits, 0));
  const { count: everVerified } = await supabase.from("bot_hits").select("id", { count: "exact", head: true }).eq("store_id", store.id);
  const { data: verifiedRows } = everVerified ? await supabase.from("bot_hits").select("seen_at").eq("store_id", store.id).eq("verified", true).gte("seen_at", `${days[0]}T00:00:00Z`).limit(10000) : { data: [] };
  const verified = days.map((d) => (verifiedRows ?? []).filter((r) => String(r.seen_at).slice(0, 10) === d).length);

  return (
    <>
      {head}
      <StatStrip
        stats={[
          { label: t("statRequests", { days: DAYS }), value: total, basis: "heuristic" },
          { label: t("statSources"), value: new Set(rows.map((r) => r.source)).size, basis: "heuristic" },
          { label: t("statVerified"), value: everVerified ? verified.reduce((a, b) => a + b, 0) : "—", basis: everVerified ? "observed" : "unavailable" },
          { label: t("statLast"), value: connector?.last_ingest_at ? formatDate(connector.last_ingest_at).replace(/ UTC.*/, "") : "—", basis: connector?.last_ingest_at ? "observed" : "unavailable" },
        ]}
      />
      {botRows.length > 0 ? (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}><strong>{tc("botsTitle")}</strong></div>
          <BarChart periods={days} series={[{ name: tc("botsUnverified"), className: "bar-b", values: claimed }, ...(everVerified ? [{ name: tc("botsVerified"), className: "bar-a", values: verified }] : [])]} label={tc("botsTitle")} />
          <Legend items={[{ name: tc("botsUnverified"), color: "#c9d8d1" }, ...(everVerified ? [{ name: tc("botsVerified"), color: "var(--emerald)" }] : [])]} />
          <p className="small"><BasisBadge basis="heuristic" /> {tc("botsUnverified")} · {everVerified ? <><BasisBadge basis="observed" /> {tc("botsVerified")}</> : <><BasisBadge basis="unavailable" /> {tc("botsVerifiedOff")}</>}</p>
        </div>
      ) : (
        <EmptyState icon="bot" title={tc("botsEmptyTitle")} text={tc("botsEmpty")} />
      )}
      <details className="card fold">
        <summary>{t("howCounted")}</summary>
        <p className="muted small">{t("uaOnly")} {t("caveat")}</p>
      </details>

      <BotIdentity supabase={supabase} storeId={store.id} />

      {checkerTotal > 0 && (
        <>
          <h2>{t("checkerTitle")}</h2>
          <div className="card">
            <p><BasisBadge basis="heuristic" /> {t("checker", { n: checkerTotal })}</p>
            <p className="muted small">{t("checkerRule")}</p>
            <table className="rtable">
              <thead><tr><th>{t("source")}</th><th>{t("category")}</th><th className="num">{t("requests")}</th></tr></thead>
              <tbody>
                {sumBy(checker, (r) => `${r.source}|${r.category}`).map(([k, hits]) => {
                  const [source, category] = k.split("|");
                  return <tr key={k}><td data-label={t("source")}>{source}</td><td data-label={t("category")}>{category}</td><td className="num" data-label={t("requests")}>{hits}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {rows.length === 0 ? (
        <EmptyState icon="plug" title={t("waitingTitle")} text={t("waiting")} />
      ) : (
        <>
          <h2>{t("bySource")}</h2>
          <div className="card table-wrap">
            <table className="rtable">
              <thead><tr><th>{t("source")}</th><th>{t("category")}</th><th>{t("confidence")}</th><th className="num">{t("requests")}</th></tr></thead>
              <tbody>
                {bySource.map(([k, hits]) => {
                  const [source, category, confidence] = k.split("|");
                  return <tr key={k}><td data-label={t("source")}>{source}</td><td data-label={t("category")}>{category}</td><td data-label={t("confidence")}><BasisBadge basis={confidence === "unverified-user-agent" ? "heuristic" : "observed"} /></td><td className="num" data-label={t("requests")}>{hits}</td></tr>;
                })}
              </tbody>
            </table>
          </div>

          <h2>{t("byPage")}</h2>
          <div className="card table-wrap">
            <table className="rtable">
              <thead><tr><th>{t("pageType")}</th><th>{t("httpStatus")}</th><th className="num">{t("requests")}</th></tr></thead>
              <tbody>
                {byRoute.map(([k, hits]) => {
                  const [route, status] = k.split("|");
                  return <tr key={k}><td data-label={t("pageType")}>{route}</td><td data-label={t("httpStatus")} className={Number(status) >= 400 ? "error" : undefined}>{status === "0" ? "—" : status}</td><td className="num" data-label={t("requests")}>{hits}</td></tr>;
                })}
              </tbody>
            </table>
          </div>

          <details className="card fold">
            <summary>{t("byDay")}</summary>
            <table className="rtable">
              <thead><tr><th>{t("day")}</th><th className="num">{t("requests")}</th></tr></thead>
              <tbody>{byDay.map(([day, hits]) => <tr key={day}><td data-label={t("day")}>{day}</td><td className="num" data-label={t("requests")}>{hits}</td></tr>)}</tbody>
            </table>
          </details>
        </>
      )}
    </>
  );
}
