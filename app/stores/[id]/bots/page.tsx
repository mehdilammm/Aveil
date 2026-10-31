import { EmptyState, PageHead } from "@/components/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BasisBadge } from "@/components/badges";
import { PlanLock } from "@/components/plan-lock";
import { botProductMap, type MapHit } from "@/lib/bot-product-map";
import { findingsForScan, getStore, listScans } from "@/lib/data";
import { storePlan } from "@/lib/plan-gate";
import { pageUrlOf } from "@/lib/sampling";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { fetchPublishedProducts } from "@/lib/woo";
import { storeAccess } from "@/lib/workspace";

export const dynamic = "force-dynamic";
const DAYS = 30;
const MAX_HITS = 20_000;

// F1: which products AI bots actually visited, and what they found wrong there.

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("bots") };
}

export default async function BotProductMapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const t = await getTranslations("botMap");
  const tx = await getTranslations("common");
  const head = (
    <PageHead title={t("title")} icon="bot" sub={t("sub", { days: DAYS })} />
  );
  const access = user ? await storeAccess(supabase, user.id, store.id) : null;
  if (!access) notFound();
  const admin = createAdminClient();
  if (!(await storePlan(admin, store.id)).botTraffic) return <>{head}<PlanLock feature="botTraffic" /></>;

  const { data: creds } = await admin.rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: access.owner_id }).maybeSingle<{ consumer_key: string; consumer_secret: string }>();
  if (!creds) return <>{head}<EmptyState icon="lock" title={<><BasisBadge basis="unavailable" /> {t("noKey")}</>} text={tx("noKeyHelp")} action={<a className="button" href="/settings">{tx("openSettings")}</a>} /></>;
  let products;
  try {
    products = await fetchPublishedProducts(store.url, { consumerKey: creds.consumer_key, consumerSecret: creds.consumer_secret });
  } catch (err) {
    return <>{head}<EmptyState icon="plug" title={<><BasisBadge basis="unavailable" /> {t("noProducts", { reason: err instanceof Error ? err.message : tx("requestFailed") })}</>} text={tx("readFailedHelp")} action={<a className="button" href="/settings">{tx("openSettings")}</a>} /></>;
  }
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const hits: MapHit[] = [];
  for (let from = 0; from < MAX_HITS; from += 1000) {
    const { data } = await supabase.from("bot_hits").select("bot, url_path, verified").eq("store_id", store.id).gte("seen_at", since).order("seen_at", { ascending: false }).range(from, from + 999);
    hits.push(...((data ?? []) as MapHit[]));
    if (!data || data.length < 1000) break;
  }
  const scan = (await listScans(supabase, id, 20)).find((s) => s.status === "complete");
  const findings = scan ? await findingsForScan(supabase, scan.id) : [];
  const list = products.items.flatMap((p) => {
    const url = pageUrlOf(store.url, p);
    return url ? [{ id: p.id, name: p.name, url }] : [];
  });
  const map = botProductMap(list, hits, findings);
  const say = (c: { msg: string; values: Record<string, string | number> }) => t(`clause.${c.msg}` as "clause.visited", c.values);

  return (
    <>
      {head}
      <p className="muted small">{t("note")}</p>
      {hits.length >= MAX_HITS && <p className="muted small">{t("capped", { n: MAX_HITS })}</p>}
      {!hits.length && <EmptyState icon="bot" title={<><BasisBadge basis="unavailable" /> {t("noHits", { days: DAYS })}</>} />}

      <h2>{t("visitedTitle", { n: map.visited.length })}</h2>
      {map.visited.length === 0 ? <p className="muted">{t("visitedNone")}</p> : map.visited.map((r) => (
        <div key={r.product.id} className="card">
          <h3><a href={r.product.url} target="_blank" rel="noopener noreferrer">{r.product.name}</a></h3>
          <p>
            {r.clauses.map((c, i) => (
              <span key={c.msg}>
                <BasisBadge basis={c.basis} /> {say(c)}{i < r.clauses.length - 1 ? t("sep") : "."}{" "}
              </span>
            ))}
          </p>
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>{t("bot")}</th><th className="num">{t("verified")}</th><th className="num">{t("claimed")}</th><th className="num">{t("pending")}</th></tr></thead>
              <tbody>
                {r.bots.map((b) => (
                  <tr key={b.bot}><td data-label={t("bot")}>{b.bot}</td><td data-label={t("verified")} className="num">{b.verified}</td><td data-label={t("claimed")} className="num">{b.claimed}</td><td data-label={t("pending")} className="num">{b.pending}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.findings.length > 1 && <p className="small muted">{t("more", { n: r.findings.length })}</p>}
          <p className="small"><Link href={`/stores/${store.id}/fix`}>{t("fix")}</Link></p>
        </div>
      ))}

      <h2>{t("unvisitedTitle", { n: map.unvisited.length })}</h2>
      {map.unvisited.length === 0 ? <p className="muted">{t("unvisitedNone")}</p> : (
        <div className="card table-wrap">
          <p className="muted small">{t("unvisitedNote")}</p>
          <table className="rtable">
            <thead><tr><th>{t("product")}</th><th>{t("topIssue")}</th></tr></thead>
            <tbody>
              {map.unvisited.map((u) => (
                <tr key={u.product.id}>
                  <td data-label={t("product")}><a href={u.product.url} target="_blank" rel="noopener noreferrer">{u.product.name}</a></td>
                  <td data-label={t("topIssue")}>{u.findings[0] ? <><BasisBadge basis={u.findings[0].basis} /> {u.findings[0].title}</> : <span className="muted">{t("noOpen")}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {map.otherPages.length > 0 && (
        <>
          <h2>{t("otherTitle")}</h2>
          <div className="card table-wrap">
            <table className="rtable">
              <thead><tr><th>{t("page")}</th><th className="num">{t("verified")}</th><th className="num">{t("claimed")}</th><th className="num">{t("pending")}</th></tr></thead>
              <tbody>
                {map.otherPages.map((o) => (
                  <tr key={o.path}><td data-label={t("page")} dir="ltr">{o.path}</td><td data-label={t("verified")} className="num">{o.verified}</td><td data-label={t("claimed")} className="num">{o.claimed}</td><td data-label={t("pending")} className="num">{o.pending}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
