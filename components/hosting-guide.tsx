import { getTranslations } from "next-intl/server";
import { BasisBadge } from "@/components/badges";
import { BLOCKED_TYPES, PROVIDERS, providersIn, type ProviderId } from "@/lib/hosting";

type F = { type: string; title: string; evidence: string; basis: string };
const SPECIFIC = new Set<ProviderId>(["cloudflare", "hostinger", "litespeed", "wordfence"]);

// F5: shown in the Fix Center when AI bots were blocked, rate-limited or challenged in the last scan.
export async function HostingGuide({ findings }: { findings: F[] }) {
  const blocked = findings.filter((f) => BLOCKED_TYPES.has(f.type) && f.basis !== "unavailable");
  if (!blocked.length) return null;
  const t = await getTranslations("hosting");
  const detected = findings.find((f) => f.type === "hosting_detected");
  const ids = detected ? providersIn(detected.evidence) : [];
  return (
    <details className="card" open>
      <summary><strong>{t("title")}</strong></summary>
      <p className="small">{t("intro")}</p>
      <ul className="small">{blocked.slice(0, 5).map((f, i) => <li key={i}><BasisBadge basis={f.basis} /> {f.title}</li>)}</ul>
      {ids.length ? (
        <>
          <p className="small"><BasisBadge basis="heuristic" /> {t("detected", { list: ids.map((id) => PROVIDERS[id].name).join(", ") })} <span className="muted">{detected?.evidence.replace(/ \[[a-z]+\]/g, "")}</span></p>
          {ids.map((id) => (
            <div key={id}>
              <h4>{PROVIDERS[id].name}</h4>
              <p className="small">{SPECIFIC.has(id) ? t(`providers.${id}` as "providers.cloudflare") : t("providerGeneric", { name: PROVIDERS[id].name })}</p>
              <p className="small"><a href={PROVIDERS[id].docs} target="_blank" rel="noopener noreferrer">{t("docs", { name: PROVIDERS[id].name })}</a></p>
            </div>
          ))}
        </>
      ) : (
        <p className="small">{t("none")}</p>
      )}
      <p className="muted small">{t("after")}</p>
    </details>
  );
}
