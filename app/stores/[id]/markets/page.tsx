import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BasisBadge, formatDate } from "@/components/badges";
import type { SimResult } from "@/lib/agent-sim";
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
export default async function MarketsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const access = user ? await storeAccess(supabase, user.id, store.id) : null;
  if (!access) notFound();
  const t = await getTranslations("markets");
  const head = (
    <div className="page-head">
      <h1>{t("title")}</h1>
      <p className="sub">{t("sub")}</p>
    </div>
  );
  const admin = createAdminClient();
  const { data: prompts } = await supabase.from("visibility_prompts").select("market").eq("store_id", store.id);
  const used = [...new Set((prompts ?? []).map((p) => p.market).filter((m): m is MarketId => Boolean(marketOf(m))))];
  const sim = <AgentSim storeId={store.id} markets={used} canRun={canEdit(access.role)} verified={await isOwnershipVerified(admin, store.id)} />;
  const { data: c } = await admin.rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: access.owner_id }).maybeSingle<{ consumer_key: string; consumer_secret: string }>();
  if (!c) return <>{head}<div className="card"><p><BasisBadge basis="unavailable" /> {t("noKey")}</p></div>{sim}</>;
  const creds = { consumerKey: c.consumer_key, consumerSecret: c.consumer_secret };
  const adapter = wooCommerceAdapter(store.url, creds);

  const [{ settings }, { zones, gateways }, page1] = await Promise.all([
    adapter.fetchPolicies(),
    adapter.fetchCheckoutSetup(),
    adapter.fetchProductsPage(1).catch(() => null),
  ]);
  if (!settings.ok) return <>{head}<div className="card"><p><BasisBadge basis="unavailable" /> {t("noSettings", { reason: settings.reason })}</p></div>{sim}</>;
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
        <table>
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
    <tr>
      <td>{marketOf(r.market)?.country ?? r.market}</td>
      <td><BasisBadge basis={basis} /> {t(`verdict.${r.verdict}`)}</td>
      <td className="small">
        {r.reasons.length === 0 ? <span className="muted">{t("noBarrier")}</span> : (
          <ul>{r.reasons.map((x) => <li key={x.code}><BasisBadge basis={x.basis} /> {t(`reason.${x.code}` as "reason.notSold", x.values)}</li>)}</ul>
        )}
      </td>
      <td className="small">
        {r.fixes.length === 0 ? "—" : r.fixes.map((f) => (
          <div key={f}><a href={`${storeUrl}/wp-admin/admin.php?page=wc-settings&tab=${FIX_TAB[f]}`} target="_blank" rel="noopener noreferrer">{t(`fixes.${f}`)}</a></div>
        ))}
      </td>
    </tr>
  );
}

// F7: the agent purchase test (Store API, never places an order) and its last result as a timeline.
async function AgentSim({ storeId, markets, canRun, verified }: { storeId: string; markets: MarketId[]; canRun: boolean; verified: boolean }) {
  const t = await getTranslations("agentSim");
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, status, error, progress, created_at").eq("store_id", storeId).eq("kind", "agent_sim").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: stepRow } = job?.status === "succeeded" ? await admin.from("job_steps").select("result").eq("job_id", job.id).eq("step_key", "simulate").maybeSingle() : { data: null };
  const result = (stepRow?.result ?? null) as SimResult | null;
  // The AI Visibility markets first, then the others.
  const options = [...MARKETS.filter((m) => markets.includes(m.id)), ...MARKETS.filter((m) => !markets.includes(m.id))].map((m) => ({ id: m.id, name: m.country }));
  const open = job && (job.status === "queued" || job.status === "running") ? job.id : null;
  const mark = { ok: "✓", warn: "!", stop: "✗", skip: "–" } as const;
  return (
    <div className="card">
      <h2>{t("title")}</h2>
      <p className="sub">{t("sub")}</p>
      <p className="muted small">{t("limits")}</p>
      {!verified ? <p><BasisBadge basis="unavailable" /> {t("notVerified")} <a href={`/stores/${storeId}`}>{t("verifyLink")}</a></p> : canRun ? <SimButton storeId={storeId} markets={options} openJobId={open} /> : null}
      {job?.status === "failed" && <p className="error">{t("lastFailed", { error: String(job.error ?? "") })}</p>}
      {result ? (
        <>
          <p>
            <strong>{result.stoppedAt ? t("stopped", { step: t(`step.${result.stoppedAt}`) }) : t("reached")}</strong>{" "}
            <span className="muted small">{t("last", { market: marketOf(result.market)?.country ?? result.market, date: formatDate(job!.created_at), n: result.requests })}</span>
          </p>
          <ol className="small">
            {result.steps.map((x, i) => (
              <li key={i}>
                <span aria-hidden="true">{mark[x.outcome]}</span> <strong>{t(`step.${x.step}`)}</strong> <BasisBadge basis={x.basis} /> {t(`code.${x.code}` as "code.robotsOk", x.values)}
                {x.http && <span className="muted"> · {x.http}</span>}
              </li>
            ))}
          </ol>
        </>
      ) : !job ? <p className="muted small">{t("none")}</p> : null}
    </div>
  );
}
