import { EmptyState, PageHead, Tech } from "@/components/ui";
import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { BasisBadge, formatDate } from "@/components/badges";
import type { SimResult, SimStep, SimStepKey } from "@/lib/agent-sim";
import { BROWSER_LIMITS } from "@/lib/browser-sim";
import { browserTestsToday, type BrowserResult } from "@/lib/browser-sim-run";
import { storePlan } from "@/lib/plan-gate";
import { PlanLock } from "@/components/plan-lock";
import { getStore } from "@/lib/data";
import { COUNTRY, marketCheckout, type MarketRow } from "@/lib/market-checkout";
import { defaultMarket, MARKETS, marketOf, type MarketId } from "@/lib/markets";
import { isOwnershipVerified } from "@/lib/ownership-store";
import { wooCommerceAdapter } from "@/lib/platform/woocommerce";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { fetchCountryStates } from "@/lib/woo";
import { canEdit, storeAccess } from "@/lib/workspace";
import { SimButton } from "./sim-button";

export const dynamic = "force-dynamic";

const FIX_TAB = { selling: "general", shipping: "shipping", payments: "checkout", accounts: "account" } as const;

// F6: can an agent complete a checkout in each market the store's AI Visibility questions target?

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("markets") };
}

export default async function MarketsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const access = user ? await storeAccess(supabase, user.id, store.id) : null;
  if (!access) notFound();
  const t = await getTranslations("markets");
  const tx = await getTranslations("common");
  const head = (
    <PageHead title={t("title")} icon="market" sub={t("sub")} />
  );
  const admin = createAdminClient();
  const { data: prompts } = await supabase.from("visibility_prompts").select("market").eq("store_id", store.id);
  const used = [...new Set((prompts ?? []).map((p) => p.market).filter((m): m is MarketId => Boolean(marketOf(m))))];
  const sim = <AgentSim storeId={store.id} markets={used} canRun={canEdit(access.role)} verified={await isOwnershipVerified(admin, store.id)} />;
  const { data: c } = await admin.rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: access.owner_id }).maybeSingle<{ consumer_key: string; consumer_secret: string }>();
  if (!c) return <>{head}<EmptyState icon="lock" title={<><BasisBadge basis="unavailable" /> {t("noKey")}</>} text={tx("noKeyHelp")} action={<a className="button" href="/settings">{tx("openSettings")}</a>} />{sim}</>;
  const creds = { consumerKey: c.consumer_key, consumerSecret: c.consumer_secret };
  const adapter = wooCommerceAdapter(store.url, creds);

  const [{ settings }, { zones, gateways }, page1] = await Promise.all([
    adapter.fetchPolicies(),
    adapter.fetchCheckoutSetup(),
    adapter.fetchProductsPage(1).catch(() => null),
  ]);
  if (!settings.ok) return <>{head}<EmptyState icon="plug" title={<><BasisBadge basis="unavailable" /> {t("noSettings", { reason: settings.reason })}</>} text={tx("readFailedHelp")} action={<a className="button" href="/settings">{tx("openSettings")}</a>} />{sim}</>;
  const markets: MarketId[] = used.length ? used : [defaultMarket(settings.data.woocommerce_default_country)];
  const states: Record<string, number | null> = {};
  for (const m of markets) states[COUNTRY[m]] = await fetchCountryStates(store.url, creds, COUNTRY[m]);
  const needsShipping = page1 ? page1.items.some((p) => !p.virtual) : true;
  const rows = marketCheckout({ markets, settings: settings.data, zones: zones.ok ? zones.data : null, gateways: gateways.ok ? gateways.data : null, states, needsShipping });

  return (
    <>
      {head}
      <p className="muted small">{t("note")}</p>
      {!used.length && <p className="muted small">{t("defaultMarket", { market: markets[0] })}</p>}
      <div className="card table-wrap">
        <table className="rtable">
          <thead><tr><th>{t("market")}</th><th>{t("can")}</th><th>{t("why")}</th><th>{t("fix")}</th></tr></thead>
          <tbody>
            {rows.map((r) => <Row key={r.market} r={r} t={t} storeUrl={store.url} />)}
          </tbody>
        </table>
      </div>
      {sim}
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"markets">>>;

function Row({ r, t, storeUrl }: { r: MarketRow; t: T; storeUrl: string }) {
  const basis = r.verdict === "unknown" ? "unavailable" : r.verdict === "probably" ? "heuristic" : "observed";
  return (
    <tr id={`market-${r.market}`}>
      <td data-label=""><strong>{marketOf(r.market)?.country ?? r.market}</strong></td>
      <td data-label={t("can")}><BasisBadge basis={basis} /> {t(`verdict.${r.verdict}`)}</td>
      <td className="small" data-label={t("why")}>
        {r.reasons.length === 0 ? <span className="muted">{t("noBarrier")}</span> : (
          <ul>{r.reasons.map((x) => <li key={x.code}><BasisBadge basis={x.basis} /> {t(`reason.${x.code}` as "reason.notSold", x.values)}</li>)}</ul>
        )}
      </td>
      <td className="small" data-label={t("fix")}>
        {r.fixes.length === 0 ? "—" : r.fixes.map((f) => (
          <div key={f}><a href={`${storeUrl}/wp-admin/admin.php?page=wc-settings&tab=${FIX_TAB[f]}`} target="_blank" rel="noopener noreferrer">{t(`fixes.${f}`)}</a></div>
        ))}
      </td>
    </tr>
  );
}

// F7: the agent purchase test (Store API, never places an order), its real-browser version (Mode B, Pro), and the
// last result of each as a timeline.
async function AgentSim({ storeId, markets, canRun, verified }: { storeId: string; markets: MarketId[]; canRun: boolean; verified: boolean }) {
  const locale = await getLocale();
  const t = await getTranslations("agentSim");
  const tu = await getTranslations("ui");
  const admin = createAdminClient();
  const last = async (kind: string, stepKey: string) => {
    const { data: job } = await admin.from("jobs").select("id, status, error, progress, created_at").eq("store_id", storeId).eq("kind", kind).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { data: stepRow } = job?.status === "succeeded" ? await admin.from("job_steps").select("result").eq("job_id", job.id).eq("step_key", stepKey).maybeSingle() : { data: null };
    return { job, result: stepRow?.result ?? null };
  };
  const [api, web, plan, today] = await Promise.all([last("agent_sim", "simulate"), last("agent_sim_browser", "browser"), storePlan(admin, storeId), browserTestsToday(admin, storeId)]);
  // The AI Visibility markets first, then the others.
  const options = [...MARKETS.filter((m) => markets.includes(m.id)), ...MARKETS.filter((m) => !markets.includes(m.id))].map((m) => ({ id: m.id, name: m.country }));
  const openOf = (j: { id: string; status: string } | null) => (j && (j.status === "queued" || j.status === "running") ? j.id : null);
  const apiResult = api.result as SimResult | null;
  const webResult = web.result as BrowserResult | null;
  return (
    <div className="card" id="purchase-test">
      <h2>{t("title")}</h2>
      <p className="sub">{t("sub")}</p>
      <p className="muted small">{t("limits")}</p>
      {!verified ? <p><BasisBadge basis="unavailable" /> {t("notVerified")} <a href={`/stores/${storeId}`}>{t("verifyLink")}</a></p> : canRun ? <SimButton storeId={storeId} markets={options} openJobId={openOf(api.job)} /> : null}
      {api.job?.status === "failed" && <p className="error">{t("lastFailed", { error: String(api.job.error ?? "") })}</p>}
      {apiResult ? <Timeline t={t} tu={tu} steps={apiResult.steps} stoppedAt={apiResult.stoppedAt} meta={t("last", { market: marketOf(apiResult.market)?.country ?? apiResult.market, date: formatDate(api.job!.created_at, locale), n: apiResult.requests })} /> : !api.job ? <p className="muted small">{t("none")}</p> : null}

      <h3>{t("browserTitle")}</h3>
      <p className="muted small">{t("browserSub", { max: BROWSER_LIMITS.perStoreDay, seconds: BROWSER_LIMITS.budgetMs / 1000 })}</p>
      {!plan.browserTests ? <PlanLock feature="browserTests" /> : !verified ? null : canRun ? (
        <>
          <SimButton storeId={storeId} markets={[]} mode="browser" openJobId={openOf(web.job)} disabled={today >= BROWSER_LIMITS.perStoreDay ? t("browserCap", { max: BROWSER_LIMITS.perStoreDay }) : null} />
          <p className="muted small">{t("browserToday", { n: today, max: BROWSER_LIMITS.perStoreDay })}</p>
        </>
      ) : null}
      {web.job?.status === "failed" && <p className="error">{t("lastFailed", { error: String(web.job.error ?? "") })}</p>}
      {webResult && (
        <>
          <Timeline t={t} tu={tu} steps={webResult.steps} stoppedAt={webResult.stoppedAt} meta={t("lastBrowser", { date: formatDate(web.job!.created_at, locale), n: webResult.requests, version: webResult.woocommerce ?? "?" })} />
          <p className="muted small">{t("cost", { usd: (webResult.cost.usd_micros / 1_000_000).toFixed(4), seconds: (webResult.cost.wall_ms / 1000).toFixed(1), memory: (webResult.cost.memory_mb / 1024).toFixed(1) })}</p>
        </>
      )}
    </div>
  );
}

type AgentT = Awaited<ReturnType<typeof getTranslations<"agentSim">>>;

function Timeline({ t, tu, steps, stoppedAt, meta }: { t: AgentT; tu: (key: "technical") => string; steps: SimStep[]; stoppedAt: SimStepKey | null; meta: string }) {
  const mark = { ok: "✓", warn: "!", stop: "✗", skip: "–" } as const;
  return (
    <>
      <p>
        <strong>{stoppedAt ? t("stopped", { step: t(`step.${stoppedAt}`) }) : t("reached")}</strong> <span className="muted small">{meta}</span>
      </p>
      <ol className="small">
        {steps.map((x, i) => (
          <li key={i}>
            <span aria-hidden="true">{mark[x.outcome]}</span> <strong>{t(`step.${x.step}`)}</strong> <BasisBadge basis={x.basis} /> {t(`code.${x.code}` as "code.robotsOk", x.values)}
          </li>
        ))}
      </ol>
      {steps.some((x) => x.http) && (
        <Tech label={tu("technical")}>
          <ul className="small muted">{steps.filter((x) => x.http).map((x, i) => <li key={i}>{t(`step.${x.step}`)}: <bdi>{x.http}</bdi></li>)}</ul>
        </Tech>
      )}
    </>
  );
}
