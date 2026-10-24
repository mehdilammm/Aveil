import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BasisBadge } from "@/components/badges";
import { findingsForScan, getStore, listScans } from "@/lib/data";
import { wooCommerceAdapter } from "@/lib/platform/woocommerce";
import { productImpact } from "@/lib/product-impact";
import { pageUrlOf } from "@/lib/sampling";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { storeAccess } from "@/lib/workspace";

export const dynamic = "force-dynamic";
const DAYS = 30;

// One line per product of the last scan's sample: readiness, AI answers about its category, AI bot visits.
export default async function ProductImpactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const t = await getTranslations("impact");
  const access = user ? await storeAccess(supabase, user.id, store.id) : null;
  const scan = (await listScans(supabase, id, 20)).find((s) => s.status === "complete");
  const head = (
    <div className="page-head">
      <h1>{t("title")}</h1>
      <p className="sub">{t("sub")}</p>
    </div>
  );
  if (!scan || !access) return <>{head}<div className="card empty"><p>{t("noScan")}</p></div></>;

  const admin = createAdminClient();
  const { data: creds } = await admin.rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: access.owner_id }).maybeSingle<{ consumer_key: string; consumer_secret: string }>();
  if (!creds) return <>{head}<div className="card"><p><BasisBadge basis="unavailable" /> {t("noKey")}</p></div></>;
  const [{ data: sample }, findings, catalog, { data: runs }] = await Promise.all([
    supabase.from("scan_schema_pages").select("product_id, url").eq("scan_id", scan.id).order("product_id"),
    findingsForScan(supabase, scan.id),
    wooCommerceAdapter(store.url, { consumerKey: creds.consumer_key, consumerSecret: creds.consumer_secret }).fetchProductsPage(1),
    supabase.from("visibility_runs").select("id").eq("store_id", store.id).eq("status", "complete").order("created_at", { ascending: false }).limit(1),
  ]);
  const { data: results } = runs?.[0] ? await supabase.from("visibility_results").select("prompt, mentioned, error").eq("run_id", runs[0].id) : { data: [] };
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const { data: hitRows } = await supabase.from("bot_hits").select("url_path, verified").eq("store_id", store.id).gte("seen_at", since).limit(20_000);
  const anyHits = (hitRows ?? []).length > 0;

  const rows = (sample ?? []).map((s) => {
    const p = catalog.items.find((x) => x.id === Number(s.product_id));
    const name = p?.name ?? `#${s.product_id}`;
    const categories = ((p as { categories?: { name: string }[] } | undefined)?.categories ?? []).map((c) => c.name);
    const path = p ? new URL(pageUrlOf(store.url, p) ?? s.url).pathname : new URL(s.url).pathname;
    const mine = (hitRows ?? []).filter((h) => h.url_path === path);
    return {
      id: Number(s.product_id),
      name,
      url: s.url as string,
      clauses: productImpact({
        product: { id: Number(s.product_id), name, categories },
        findings: findings.filter((f) => f.product_id === Number(s.product_id)),
        answers: (results ?? []) as { prompt: string; mentioned: boolean | null; error: string | null }[],
        hits: anyHits ? { verified: mine.filter((h) => h.verified === true).length, claim: mine.filter((h) => h.verified === false).length, pending: mine.filter((h) => h.verified === null).length } : null,
        days: DAYS,
      }),
    };
  });

  return (
    <>
      {head}
      <p className="muted small">{t("note")}</p>
      {rows.map((r) => (
        <div key={r.id} className="card">
          <h3><a href={r.url} target="_blank" rel="noopener noreferrer">{r.name}</a></h3>
          <p>
            {r.clauses.map((c, i) => (
              <span key={c.key}>
                <BasisBadge basis={c.basis} /> {t(`clause.${c.msg}`, c.values)}{i < r.clauses.length - 1 ? t("sep") : "."}{" "}
              </span>
            ))}
          </p>
          <p className="small"><Link href={`/stores/${store.id}/fix`}>{t("fix")}</Link></p>
        </div>
      ))}
    </>
  );
}
