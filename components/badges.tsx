export function SeverityBadge({ severity }: { severity: string }) {
  const label = severity === "high" ? "Critical" : severity === "medium" ? "Warning" : "Low";
  return <span className={`badge sev-${severity}`}>{label}</span>;
}

export function BasisBadge({ basis }: { basis: string }) {
  return <span className={`badge basis-${basis}`}>{basis}</span>;
}

export function StateBadge({ state }: { state: string | null }) {
  if (!state) return null;
  return <span className={`badge state ${state === "resolved" ? "state-resolved" : ""}`}>{state}</span>;
}

export function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "—";
}
