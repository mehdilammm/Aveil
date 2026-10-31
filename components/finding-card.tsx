import { useTranslations } from "next-intl";
import { areaOf } from "@/lib/categories";
import type { FindingRow } from "@/lib/data";
import { marketLinks } from "@/lib/market-fixes";
import { BasisBadge, SeverityBadge, StateBadge } from "./badges";
import { AREA_ICON, Icon } from "./icons";
import { Tech } from "./ui";

// One finding: severity (the strong badge), the plain title and how to fix it first; what was measured (evidence)
// is folded under "Technical details". resolvedLabel: set when a targeted re-check verified the fix (greyed).
// storeId: links a Checkout by market item to its market row and the last purchase test.
export function FindingCard({ finding, storeUrl, storeId, children, resolvedLabel, tech }: { finding: FindingRow; storeUrl: string; storeId?: string; children?: React.ReactNode; resolvedLabel?: string; tech?: React.ReactNode }) {
  const t = useTranslations("ui");
  const ta = useTranslations("areas");
  const area = areaOf(finding);
  const link = finding.product_id ? { href: `${storeUrl}/wp-admin/post.php?post=${finding.product_id}&action=edit`, label: t("editProduct", { id: finding.product_id }) } : finding.fix_url ? { href: finding.fix_url, label: t("openWordpress") } : null;
  const market = storeId ? marketLinks(storeId, finding.finding_key) : null;
  return (
    <article id={`f-${finding.finding_key}`} className={`card finding${resolvedLabel ? " finding-resolved" : ""}`}>
      <div className="finding-top">
        {resolvedLabel ? <span className="badge state-resolved">{resolvedLabel}</span> : <SeverityBadge severity={finding.severity} />}
        <BasisBadge basis={finding.basis} />
        {!resolvedLabel && <StateBadge state={finding.state} />}
        <span className="meta"><Icon name={AREA_ICON[area]} size="sm" /> {ta(`${area}.label`)}</span>
      </div>
      <h3>{finding.title}</h3>
      <p className="guidance"><strong>{t("howToFix")}:</strong> {finding.guidance}</p>
      <div className="finding-actions">
        {link && <a className="small" href={link.href} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>}
        {market && <a className="small" href={market.row}>{t("marketRow")}</a>}
        {market && <a className="small" href={market.test}>{t("lastTest")}</a>}
      </div>
      {children}
      <Tech label={t("technical")}>
        <p className="evidence small">{finding.evidence}</p>
        {tech}
      </Tech>
    </article>
  );
}
