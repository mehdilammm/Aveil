import { useTranslations } from "next-intl";
import { areaOf } from "@/lib/categories";
import type { FindingRow } from "@/lib/data";
import { groupSeverity, plainSentence, type FindingGroup } from "@/lib/finding-groups";
import { marketLinks } from "@/lib/market-fixes";
import { BasisBadge, SeverityBadge, StateBadge } from "./badges";
import { AREA_ICON, Icon } from "./icons";
import { Tech } from "./ui";

// One card per kind of finding: the severity and one plain sentence ("15 products have no brand"); the products or
// items it covers are folded in a list, each with its own actions. What was measured (basis, area, the scan's title,
// evidence, guidance, priority) is under "Technical details". resolvedLabel: the fixes a re-check verified (greyed).
export function FindingGroupCard({ group, storeUrl, storeId, actions, tech, resolvedLabel }: { group: FindingGroup; storeUrl: string; storeId?: string; actions?: (f: FindingRow) => React.ReactNode; tech?: React.ReactNode; resolvedLabel?: string }) {
  const t = useTranslations("ui");
  const tp = useTranslations("plain");
  const ta = useTranslations("areas");
  const first = group.items[0];
  const area = areaOf(first);
  const plain = tp.has(group.type);
  const single = group.items.length === 1;
  const products = group.items.every((f) => f.product_id);

  const links = (f: FindingRow, withProduct: boolean) => {
    const market = storeId ? marketLinks(storeId, f.finding_key) : null;
    return (
      <>
        {f.product_id && withProduct ? (
          <a className="small" href={`${storeUrl}/wp-admin/post.php?post=${f.product_id}&action=edit`} target="_blank" rel="noopener noreferrer">{t("editProduct", { id: f.product_id })} ↗</a>
        ) : !f.product_id && f.fix_url ? (
          <a className="small" href={f.fix_url} target="_blank" rel="noopener noreferrer">{t("openWordpress")} ↗</a>
        ) : null}
        {market && <a className="small" href={market.row}>{t("marketRow")}</a>}
        {market && <a className="small" href={market.test}>{t("lastTest")}</a>}
      </>
    );
  };

  return (
    <article id={`g-${group.type}`} className={`card finding${resolvedLabel ? " finding-resolved" : ""}`}>
      <div className="finding-top">
        {resolvedLabel ? <span className="badge state-resolved">{resolvedLabel}</span> : <SeverityBadge severity={groupSeverity(group)} />}
      </div>
      <h3>{plainSentence(tp, group)}</h3>
      {!plain && single && <p className="guidance"><strong>{t("howToFix")}:</strong> {first.guidance}</p>}
      {single ? (
        <div id={`f-${first.finding_key}`} className="finding-actions">
          {links(first, true)}
          {actions?.(first)}
        </div>
      ) : (
        <details className="group-items">
          <summary>{products ? t("seeProducts", { n: group.items.length }) : t("seeList", { n: group.items.length })}</summary>
          <ul className="group-list">
            {group.items.map((f) => (
              <li key={f.finding_key} id={`f-${f.finding_key}`}>
                {!f.product_id && <span className="small">{f.title}</span>}
                <div className="finding-actions">
                  {links(f, true)}
                  {actions?.(f)}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Tech label={t("technical")}>
        <p className="row small">
          <BasisBadge basis={first.basis} />
          {!resolvedLabel && <StateBadge state={first.state} />}
          <span className="meta"><Icon name={AREA_ICON[area]} size="sm" /> {ta(`${area}.label`)}</span>
        </p>
        {(plain || !single) && <p className="small"><strong>{first.title}</strong></p>}
        {(plain || !single) && <p className="small">{t("howToFix")}: {first.guidance}</p>}
        {single ? (
          <p className="evidence small">{first.evidence}</p>
        ) : (
          <ul className="evidence small">
            {group.items.map((f) => <li key={f.finding_key}>{f.product_id ? `#${f.product_id}` : f.title}: {f.evidence}</li>)}
          </ul>
        )}
        {tech}
      </Tech>
    </article>
  );
}
