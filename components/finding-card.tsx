import { areaOf, AREAS } from "@/lib/categories";
import { editorUrl, type FindingRow } from "@/lib/data";
import { marketLinks } from "@/lib/market-fixes";
import { BasisBadge, SeverityBadge, StateBadge } from "./badges";

// resolvedLabel: set when a targeted re-check verified the fix; the card is greyed and shows only that state.
// storeId: links a Checkout by market item to its market row and the last purchase test.
export function FindingCard({ finding, storeUrl, storeId, children, resolvedLabel }: { finding: FindingRow; storeUrl: string; storeId?: string; children?: React.ReactNode; resolvedLabel?: string }) {
  const link = editorUrl(storeUrl, finding);
  const market = storeId ? marketLinks(storeId, finding.finding_key) : null;
  return (
    <div className={`card finding${resolvedLabel ? " finding-resolved" : ""}`}>
      <div className="row">
        {resolvedLabel ? (
          <span className="badge state-resolved">{resolvedLabel}</span>
        ) : (
          <>
            <SeverityBadge severity={finding.severity} />
            <BasisBadge basis={finding.basis} />
            <StateBadge state={finding.state} />
          </>
        )}
        <span className="badge area-tag">{AREAS.find((a) => a.key === areaOf(finding))?.label}</span>
      </div>
      <h3>{finding.title}</h3>
      <p className="evidence">{finding.evidence}</p>
      <p className="guidance">{finding.guidance}</p>
      {link && <a href={link.href} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>}
      {market && <p className="small"><a href={market.row}>Market row</a> · <a href={market.test}>Last purchase test</a></p>}
      {children}
    </div>
  );
}
