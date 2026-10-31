import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { BasisBadge, formatDate } from "@/components/badges";
import { CopyBox } from "@/components/copy-box";
import { getStore } from "@/lib/data";
import { diffLines, plain } from "@/lib/fixes/description";
import { wooCommerceAdapter } from "@/lib/platform/woocommerce";
import { sampleProducts } from "@/lib/sampling";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";
import { DraftForm } from "./draft-form";
import { setDraftStatus } from "./actions";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

type DraftRow = { id: string; product_id: number; product_name: string; current_html: string; proposed_html: string; inputs: Record<string, string>; unknowns: string[]; status: string; approved_at: string | null };

export async function generateMetadata() {
  return { title: (await getTranslations("descriptions"))("title") };
}

export default async function DescriptionsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ product?: string }> }) {
  const locale = await getLocale();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { supabase, user } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const t = await getTranslations("descriptions");
  const tx = await getTranslations("common");
  const access = user ? await storeAccess(supabase, user.id, store.id) : null;
  if (!access || !canEdit(access.role)) return <div className="card"><p>{t("editorsOnly")}</p></div>;

  const admin = createAdminClient();
  const { data: creds } = await admin.rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: access.owner_id }).maybeSingle<{ consumer_key: string; consumer_secret: string }>();
  if (!creds) return <EmptyState icon="lock" title={<><BasisBadge basis="unavailable" /> {t("noKey")}</>} text={tx("noKeyHelp")} action={<a className="button" href="/settings">{tx("openSettings")}</a>} />;
  const adapter = wooCommerceAdapter(store.url, { consumerKey: creds.consumer_key, consumerSecret: creds.consumer_secret });
  const products = sampleProducts(store.url, (await adapter.fetchProductsPage(1)).items, 50).items;
  const { data: rows } = await supabase.from("description_drafts").select("id, product_id, product_name, current_html, proposed_html, inputs, unknowns, status, approved_at").eq("store_id", store.id).neq("status", "discarded");
  const drafts = new Map(((rows ?? []) as DraftRow[]).map((d) => [d.product_id, d]));
  const selected = Number(sp.product) || null;
  const product = products.find((p) => p.id === selected) ?? null;
  const draft = selected ? drafts.get(selected) : undefined;
  const approved = [...drafts.values()].filter((d) => d.status === "approved");
  const base = `/stores/${store.id}/fix/descriptions`;

  return (
    <>
      <p><Link href={`/stores/${store.id}/fix`}>← {t("back")}</Link></p>
      <div className="page-head">
        <h1>{t("title")}</h1>
        <p className="sub">{t("sub")}</p>
      </div>

      <div className="card">
        <p className="small">{t("pick")}</p>
        <div className="row small" style={{ flexWrap: "wrap", gap: 6 }}>
          {products.map((p) => (
            <Link key={p.id} href={`${base}?product=${p.id}`} className={`badge ${p.id === selected ? "basis-observed" : drafts.get(p.id)?.status === "approved" ? "state-resolved" : "basis-unavailable"}`}>{p.name}</Link>
          ))}
        </div>
      </div>

      {product && (
        <div className="card stack">
          <h2>{product.name}</h2>
          <DraftForm storeId={store.id} productId={product.id} inputs={draft?.inputs ?? {}} />
        </div>
      )}

      {draft && (
        <div className="card stack">
          <h2>{t("review")}</h2>
          {draft.unknowns.length > 0 && <p className="small"><BasisBadge basis="unavailable" /> {t("unknowns", { list: draft.unknowns.join(", ") })}</p>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t("current")}</th><th>{t("proposed")}</th></tr></thead>
              <tbody>
                {diffLines(plain(draft.current_html), plain(draft.proposed_html)).map((r, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "normal", background: r.kind === "removed" ? "var(--red-bg, #fdecec)" : undefined }}>{r.kind !== "added" ? r.text : ""}</td>
                    <td style={{ whiteSpace: "normal", background: r.kind === "added" ? "var(--green-bg, #e8f6ef)" : undefined }}>{r.kind !== "removed" ? r.text : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">{t("onlyFacts")}</p>
          {draft.status === "approved" ? (
            <>
              <p className="small"><BasisBadge basis="observed" /> {t("approvedOn", { date: formatDate(draft.approved_at, locale) })}</p>
              <CopyBox text={draft.proposed_html} rows={10} />
            </>
          ) : (
            <form action={setDraftStatus} className="row">
              <input type="hidden" name="store_id" value={store.id} />
              <input type="hidden" name="draft_id" value={draft.id} />
              <button name="status" value="approved">{t("approve")}</button>
              <button name="status" value="discarded" className="secondary">{t("discard")}</button>
            </form>
          )}
        </div>
      )}

      {approved.length > 0 && (
        <div className="card stack">
          <h2>{t("approvedTitle", { n: approved.length })}</h2>
          <p className="small">{t("exportHow")}</p>
          <div><a className="button secondary" href={`/api/stores/${store.id}/descriptions.csv`}>{t("export")}</a></div>
        </div>
      )}
    </>
  );
}
