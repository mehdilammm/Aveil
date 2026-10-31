import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate } from "@/components/badges";
import { FindingCard } from "@/components/finding-card";
import { findingsForScan, getStore, sortForFixing } from "@/lib/data";
import { resolvedKeys } from "@/lib/history";
import { getUser } from "@/lib/supabase/server";
import { getTranslations, getLocale } from "next-intl/server";
import { BasisBadge } from "@/components/badges";

export default async function ScanPage({ params }: { params: Promise<{ id: string; scanId: string }> }) {
  const locale = await getLocale();
  const { id, scanId } = await params;
  const { supabase } = await getUser();
  const [store, { data: scan }] = await Promise.all([
    getStore(supabase, id),
    supabase.from("scans").select("id, status, created_at, finished_at, scanned_products, findings_count, error, requests_count, cost_usd_micros, sampled_products, sample_basis").eq("id", scanId).eq("store_id", id).maybeSingle(),
  ]);
  if (!store || !scan) notFound();

  const { data: prev } = await supabase
    .from("scans")
    .select("id, finished_at")
    .eq("store_id", id)
    .eq("status", "complete")
    .lt("created_at", scan.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const [current, previous] = await Promise.all([findingsForScan(supabase, scanId), prev ? findingsForScan(supabase, prev.id) : Promise.resolve([])]);
  const gone = new Set(resolvedKeys(new Set(current.map((f) => f.finding_key)), new Set(previous.map((f) => f.finding_key))));
  const resolved = previous.filter((f) => gone.has(f.finding_key));
  const count = (state: string) => current.filter((f) => f.state === state).length;
  const [{ data: schemaPages }, t] = await Promise.all([
    supabase.from("scan_schema_pages").select("product_id, url, primary_source, primary_id, duplicate, sources, error").eq("scan_id", scanId).order("product_id"),
    getTranslations("scanDetail"),
  ]);
  const tn = await getTranslations("nav");

  return (
    <>
      <p><Link href={`/stores/${store.id}/readiness`}>← {tn("readiness")}</Link></p>
      <div className="page-head">
        <h1>{t("title", { date: formatDate(scan.finished_at, locale) })}</h1>
        <p className="sub">{t("summary", { products: scan.scanned_products ?? 0, findings: scan.findings_count ?? 0 })}</p>
        {scan.error && <p className={scan.status === "failed" ? "error" : "muted"}>{scan.error}</p>}
        <p>
          {prev ? (
            <>{t("compared", { date: formatDate(prev.finished_at, locale), new: count("new"), ongoing: count("ongoing"), recurred: count("recurred"), resolved: resolved.length })}</>
          ) : (
            <span className="muted">{t("firstScan")}</span>
          )}
        </p>
      </div>

      {(scan.requests_count !== null || (schemaPages ?? []).length > 0) && (
        <div className="card">
          {scan.requests_count !== null && (
            <p className="small"><BasisBadge basis="observed" /> {t("cost", { requests: scan.requests_count, cost: (Number(scan.cost_usd_micros ?? 0) / 1e6).toFixed(2) })}</p>
          )}
          {scan.sampled_products !== null && (
            <p className="small">{t(scan.sample_basis === "sales" ? "sampleSales" : "sampleCategories", { n: scan.sampled_products })}</p>
          )}
          {(schemaPages ?? []).length > 0 && (
            <details>
              <summary className="small">{t("schemaTitle")}</summary>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t("page")}</th><th>{t("source")}</th><th>{t("productId")}</th></tr></thead>
                  <tbody>
                    {(schemaPages ?? []).map((r) => (
                      <tr key={r.product_id}>
                        <td><a href={r.url} target="_blank" rel="noopener noreferrer">{new URL(r.url).pathname}</a></td>
                        <td>{r.error ? <span className="muted">{t("unavailable", { reason: r.error })}</span> : r.primary_source ? `${t(`src_${r.primary_source}`)}${r.duplicate ? ` · ${t("duplicate")}` : ""}` : t("noProduct")}</td>
                        <td className="small">{r.primary_id ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">{t("schemaNote")}</p>
            </details>
          )}
        </div>
      )}

      {sortForFixing(current).map((f) => <FindingCard key={f.finding_key} finding={f} storeUrl={store.url} />)}

      {resolved.length > 0 && (
        <>
          <h2>{t("resolvedSince")}</h2>
          {resolved.map((f) => <FindingCard key={f.finding_key} finding={{ ...f, state: "resolved" }} storeUrl={store.url} />)}
        </>
      )}
    </>
  );
}
