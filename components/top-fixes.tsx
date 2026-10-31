import Link from "next/link";
import { useTranslations } from "next-intl";
import { groupSeverity, plainSentence, type FindingGroup } from "@/lib/finding-groups";
import { SeverityBadge } from "./badges";
import { Icon } from "./icons";

// The first fixes as short rows: severity and one plain sentence, each opening its card in Fix Center.
export function TopFixes({ groups, storeId }: { groups: FindingGroup[]; storeId: string }) {
  const t = useTranslations("plain");
  return (
    <ol className="card top-fixes">
      {groups.map((g) => (
        <li key={g.type}>
          <Link href={`/stores/${storeId}/fix#g-${g.type}`}>
            <SeverityBadge severity={groupSeverity(g)} />
            <span>{plainSentence(t, g)}</span>
            <Icon name="arrow" size="sm" />
          </Link>
        </li>
      ))}
    </ol>
  );
}
