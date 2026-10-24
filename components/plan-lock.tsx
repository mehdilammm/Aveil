import Link from "next/link";
import { useTranslations } from "next-intl";
import { planFor, PLANS, type PlanFeature } from "@/lib/plans";

// What a locked feature shows (G7): Unavailable with the plan it needs, and Upgrade (the waitlist for now).
export function PlanLock({ feature, note }: { feature: PlanFeature; note?: string }) {
  const t = useTranslations("plan");
  return (
    <div className="card">
      <p><span className="badge basis-unavailable">{t("locked", { plan: PLANS[planFor(feature)].name })}</span> {t(`why.${feature}`)}</p>
      {note && <p className="muted small">{note}</p>}
      <Link className="button" href="/pricing">{t("upgrade")}</Link>
    </div>
  );
}
