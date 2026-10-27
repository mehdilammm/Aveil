import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BasisBadge } from "@/components/badges";
import { getStore } from "@/lib/data";
import { COUNTRY, marketCheckout, type MarketRow } from "@/lib/market-checkout";
import { defaultMarket, marketOf, type MarketId } from "@/lib/markets";
import { wooCommerceAdapter } from "@/lib/platform/woocommerce";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { fetchCountryStates } from "@/lib/woo";
import { storeAccess } from "@/lib/workspace";

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
  const { data: c } = await admin.rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: access.owner_id }).maybeSingle<{ consumer_key: string; consumer_secret: string }>();
  if (!c) return <>{head}<div className="card"><p><BasisBadge basis="unavailable" /> {t("noKey")}</p></div></>;
  const creds = { consumerKey: c.consumer_key, consumerSecret: c.consumer_secret };
  const adapter = wooCommerceAdapter(store.url, creds);

  const [{ settings }, { zones, gateways }, page1, { data: prompts }] = await Promise.all([
    adapter.fetchPolicies(),
    adapter.fetchCheckoutSetup(),
    adapter.fetchProductsPage(1).catch(() => null),
    supabase.from("visibility_prompts").select("market").eq("store_id", store.id),
  ]);
  if (!settings.ok) return <>{head}<div className="card"><p><BasisBadge basis="unavailable" /> {t("noSettings", { reason: settings.reason })}</p></div></>;
  const used = [...new Set((prompts ?? []).map((p) => p.market).filter((m): m is MarketId => Boolean(marketOf(m))))];
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
