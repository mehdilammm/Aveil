import { getTranslations, getLocale } from "next-intl/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OwnershipForm } from "@/app/stores/[id]/ownership-form";
import { formatDate } from "@/components/badges";
import { isCurrent, MANUAL_METHODS, META_NAME, TOKEN_PREFIX, WELL_KNOWN_PATH } from "@/lib/ownership";

type Row = { method: string; token: string | null; verified_at: string | null; expires_at: string | null; checked_at: string | null; evidence: string | null };

// How AgentScope knows this store is the user's: the API key (each scan), or a DNS record, meta tag or file.
// Write actions (later) need a current verification.
export async function OwnershipCard({ supabase, storeId, storeUrl, canEdit }: { supabase: SupabaseClient; storeId: string; storeUrl: string; canEdit: boolean }) {
  const locale = await getLocale();
  const t = await getTranslations("ownership");
  const { data } = await supabase.from("store_verifications").select("method, token, verified_at, expires_at, checked_at, evidence").eq("store_id", storeId);
  const rows = (data ?? []) as Row[];
  const by = new Map(rows.map((r) => [r.method, r]));
  const current = rows.filter((r) => isCurrent(r));
  const host = new URL(storeUrl).hostname;
  const how = (method: string, token: string) =>
    method === "dns_txt" ? t("howDns", { host, value: `${TOKEN_PREFIX}${token}` })
    : method === "meta_tag" ? t("howMeta", { tag: `<meta name="${META_NAME}" content="${token}">` })
    : t("howFile", { url: `${storeUrl}${WELL_KNOWN_PATH}`, token });
  return (
    <>
      <h2>{t("title")}</h2>
      <div className="card">
        {current.length ? (
          <p><span className="badge basis-observed">{t("verified")}</span> {current.map((r) => t(`m_${r.method}`)).join(", ")} · {t("until", { date: formatDate(current[0].expires_at, locale) })}</p>
        ) : (
          <p><span className="badge basis-unavailable">{t("notVerified")}</span> {t("notVerifiedNote")}</p>
        )}
        <p className="muted small">{t("intro")}</p>
        {canEdit && (
          <details>
            <summary className="small">{t("other")}</summary>
            {MANUAL_METHODS.map((m) => {
              const r = by.get(m);
              return (
                <div key={m} className="stack" style={{ marginBlock: 10 }}>
                  <strong className="small">{t(`m_${m}`)}{r && isCurrent(r) ? ` · ${t("verified")}` : ""}</strong>
                  {r?.token && <code className="small" style={{ overflowWrap: "anywhere" }}>{how(m, r.token)}</code>}
                  {r?.checked_at && !isCurrent(r) && r.evidence && <span className="muted small">{t("lastCheck", { date: formatDate(r.checked_at, locale), evidence: r.evidence })}</span>}
                  <OwnershipForm storeId={storeId} method={m} hasToken={Boolean(r?.token)} />
                </div>
              );
            })}
          </details>
        )}
      </div>
    </>
  );
}
