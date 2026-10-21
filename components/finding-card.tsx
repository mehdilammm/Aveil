import { editorUrl, type FindingRow } from "@/lib/data";
import { BasisBadge, SeverityBadge, StateBadge } from "./badges";

export function FindingCard({ finding, storeUrl }: { finding: FindingRow; storeUrl: string }) {
  const link = editorUrl(storeUrl, finding);
  return (
    <div className="card finding">
      <div className="row">
        <SeverityBadge severity={finding.severity} />
        <BasisBadge basis={finding.basis} />
        <StateBadge state={finding.state} />
      </div>
      <h3>{finding.title}</h3>
      <p className="evidence">{finding.evidence}</p>
      <p className="guidance">{finding.guidance}</p>
      {link && <a href={link.href} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>}
    </div>
  );
}
