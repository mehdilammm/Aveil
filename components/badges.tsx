import { useTranslations } from "next-intl";

// Level 1: severity, the one strong badge on a card.
export function SeverityBadge({ severity }: { severity: string }) {
  const t = useTranslations("ui");
  const s = severity === "high" || severity === "medium" ? severity : "low";
  return <span className={`badge sev-${s}`}>{t(`sev_${s}`)}</span>;
}

// Level 2: how it was measured (Observed / Heuristic / Unavailable), a quiet dot and word.
export function BasisBadge({ basis }: { basis: string }) {
  const t = useTranslations("ui");
  const b = basis === "observed" || basis === "heuristic" ? basis : "unavailable";
  return <span className={`badge basis-${b}`}>{t(`basis_${b}`)}</span>;
}

// Level 3: plain text (new / ongoing / back again), or a soft badge once resolved.
export function StateBadge({ state }: { state: string | null }) {
  const t = useTranslations("ui");
  if (!state || !["new", "ongoing", "recurred", "resolved"].includes(state)) return null;
  return <span className={`badge state ${state === "resolved" ? "state-resolved" : ""}`}>{t(`state_${state}`)}</span>;
}

// Dates in UTC in the reader's language (Intl), isolated so they keep their order inside the other direction's text.
// Arabic uses Western digits, as Moroccan stores do.
export function formatDate(value: string | null, locale = "en") {
  if (!value) return "—";
  const tag = locale === "ar" ? "ar-u-nu-latn" : "en-GB";
  return `\u2068${new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC\u2069`;
}
