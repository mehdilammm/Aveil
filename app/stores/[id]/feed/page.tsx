import { EmptyState, PageHead } from "@/components/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { BasisBadge, formatDate } from "@/components/badges";
import { PlanLock } from "@/components/plan-lock";
import { getStore } from "@/lib/data";
import { FEED_SPEC } from "@/lib/feed-build";
import { activeFeedFix } from "@/lib/feed-jobs";
import { buildStoreFeed } from "@/lib/feed-run";
import { storePlan } from "@/lib/plan-gate";
import { callPlugin, type PluginAnswer } from "@/lib/plugin-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { storeAccess } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// G1: the product feed's health: what the plugin serves now, and, from the store's products read now, which
// products are in it and which are left out (with the reason and the missing fields).
export default async function FeedPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const { id } = await params;
  const { supabase, user } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const access = user ? await storeAccess(supabase, user.id, store.id) : null;
  if (!access) notFound();
  const t = await getTranslations("feed");
  const tx = await getTranslations("common");
  const head = (
    <PageHead title={t("title")} icon="feed" sub={t("sub", { spec: `${FEED_SPEC.name} ${FEED_SPEC.version}` })} />
  );
  const admin = createAdminClient();
  if (!(await storePlan(admin, store.id)).productFeed) return <>{head}<PlanLock feature="productFeed" /></>;
  const [{ data: c }, { data: connector }, active] = await Promise.all([
    admin.rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: access.owner_id }).maybeSingle<{ consumer_key: string; consumer_secret: string }>(),
    admin.rpc("get_traffic_connector_secret", { p_store_id: store.id }).maybeSingle<{ token: string }>(),
    activeFeedFix(admin, store.id),
  ]);
  if (!c) return <>{head}<EmptyState icon="lock" title={<><BasisBadge basis="unavailable" /> {t("noKey")}</>} text={tx("noKeyHelp")} action={<a className="button" href="/settings">{tx("openSettings")}</a>} /></>;

  let status: PluginAnswer | null = null;
  let statusError: string | null = null;
  if (connector?.token) status = await callPlugin(store.url, connector.token, { action: "status" }).catch((e: Error) => ((statusError = e.message), null));
  let feed: Awaited<ReturnType<typeof buildStoreFeed>> | null = null;
  let buildError: string | null = null;
  try {
    feed = await buildStoreFeed(store, { consumerKey: c.consumer_key, consumerSecret: c.consumer_secret });
  } catch (e) {
    buildError = (e as Error).message;
  }
  const served = status?.feed ?? null;
  const { data: lastRefresh } = await admin.from("jobs").select("status, error, updated_at").eq("store_id", store.id).eq("kind", "feed_refresh").order("created_at", { ascending: false }).limit(1).maybeSingle();

  return (
    <>
      {head}
      <div className="card">
        <h2>{t("servedTitle")}</h2>
        {!connector?.token ? <p><BasisBadge basis="unavailable" /> {t("noPlugin")}</p>
          : statusError ? <p><BasisBadge basis="unavailable" /> {t("statusError", { reason: statusError })}</p>
          : status && status.feed === undefined ? <p><BasisBadge basis="unavailable" /> {t("oldPlugin", { version: status.plugin_version })}</p>
          : served ? (
            <>
              <p><BasisBadge basis="observed" /> {t("served", { n: served.products, date: formatDate(new Date(served.updated_at * 1000).toISOString(), locale) })}</p>
              <ul className="small">
                <li>JSONL ({FEED_SPEC.name}): <a href={served.urls.jsonl} target="_blank" rel="noopener noreferrer">{served.urls.jsonl}</a></li>
                <li>metadata.json: <a href={served.urls.metadata} target="_blank" rel="noopener noreferrer">{served.urls.metadata}</a></li>
                <li>CSV (Google Merchant): <a href={served.urls.csv} target="_blank" rel="noopener noreferrer">{served.urls.csv}</a></li>
              </ul>
            </>
          ) : <p><BasisBadge basis="observed" /> {t("notServed")} {active ? null : <Link href={`/stores/${store.id}/fix`}>{t("toFix")}</Link>}</p>}
        {lastRefresh && <p className="muted small">{t("lastRefresh", { status: lastRefresh.status, date: formatDate(lastRefresh.updated_at, locale) })}{lastRefresh.error ? ` ${lastRefresh.error}` : ""}</p>}
        <p className="muted small">{t("submit")}</p>
      </div>

      <div className="card table-wrap">
        <h2>{t("productsTitle")}</h2>
        {buildError ? <p><BasisBadge basis="unavailable" /> {t("buildError", { reason: buildError })}</p> : feed && (
          <>
            <p className="small">{t("counts", { products: feed.counts.products, variants: feed.counts.variants, excluded: feed.counts.excluded, csv: feed.counts.csvRows, csvExcluded: feed.counts.csvExcluded })}</p>
            <table>
              <thead><tr><th>{t("product")}</th><th>JSON</th><th>CSV</th><th>{t("missing")}</th></tr></thead>
              <tbody>
                {feed.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name} <span className="muted small">#{r.id}</span></td>
                    <td><BasisBadge basis="observed" /> {r.json === "included" ? t("included", { n: r.variants }) : t("excluded", { reason: r.jsonReason ?? "" })}</td>
                    <td>{r.csv === "included" ? t("csvIncluded") : t("csvExcluded", { fields: r.csvMissing.join(", ") })}</td>
                    <td className="small">{r.missing.length ? <>{r.missing.join(", ")} · <Link href={`/stores/${store.id}/fix`}>{t("toFix")}</Link></> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">{t("note")}</p>
          </>
        )}
      </div>
    </>
  );
}

