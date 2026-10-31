// Charts drawn on the server in HTML and a little SVG: no chart library and no client JavaScript. Bars and points are
// positioned with logical CSS (inset-inline-start), so time runs in the reading direction (right to left in Arabic),
// and the text stays at its real size on phones. Every mark is a real value; when there is nothing to draw the caller's
// `empty` state is shown instead of a flat or invented line. A tap or hover shows the value; "Show the numbers" lists
// them as a table (screen readers and print).
import { useLocale, useTranslations } from "next-intl";
import { BasisBadge } from "./badges";

export type Point = { at: string; value: number };

const niceMax = (v: number) => {
  if (v <= 5) return Math.max(1, Math.ceil(v));
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
};
export const shortDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
const edge = (i: number, n: number) => (i < 2 ? " tip-start" : i > n - 3 ? " tip-end" : "");

function Axis({ max }: { max: number }) {
  return (
    <div className="chart-y" aria-hidden="true">
      <span style={{ bottom: "100%" }}>{max}</span>
      <span style={{ bottom: "50%" }}>{Math.round(max / 2)}</span>
      <span style={{ bottom: "0%" }}>0</span>
    </div>
  );
}

function XLabels({ labels }: { labels: string[] }) {
  return (
    <div className="chart-x" aria-hidden="true">
      {labels.map((l, i) => <span key={i}>{l}</span>)}
    </div>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  const t = useTranslations("charts");
  return (
    <details className="chart-data">
      <summary>{t("showData")}</summary>
      <table className="rtable">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} data-label={j ? head[j] : ""} className={j ? "num" : undefined}>{c}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}

// Issues over time (one point per complete scan), with the days a fix was applied marked. Needs two points.
export function LineChart({ points, marks = [], label, valueLabel, seriesName, empty }: { points: Point[]; marks?: { at: string; label: string }[]; label: string; valueLabel: (p: Point, date: string) => string; seriesName: string; empty: React.ReactNode }) {
  const locale = useLocale();
  const t = useTranslations("charts");
  if (points.length < 2) return <>{empty}</>;
  const sorted = [...points].sort((a, b) => a.at.localeCompare(b.at));
  const t0 = Date.parse(sorted[0].at);
  const span = Math.max(Date.parse(sorted[sorted.length - 1].at) - t0, 1);
  const max = niceMax(Math.max(...sorted.map((p) => p.value)));
  const x = (at: string) => ((Date.parse(at) - t0) / span) * 100;
  const y = (v: number) => (v / max) * 100;
  const shown = marks.filter((m) => x(m.at) >= 0 && x(m.at) <= 100);
  return (
    <figure className="chart" aria-label={label}>
      <div className="chart-plot">
        <Axis max={max} />
        <div className="chart-area" aria-hidden="true">
          <div className="chart-grid"><i /><i /><i /></div>
          {shown.map((m, i) => <i key={i} className="fix-mark" style={{ insetInlineStart: `${x(m.at)}%` }} title={m.label} />)}
          <svg className="chart-line" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points={sorted.map((p) => `${x(p.at).toFixed(2)},${(100 - y(p.value)).toFixed(2)}`).join(" ")} vectorEffect="non-scaling-stroke" />
          </svg>
          {sorted.map((p, i) => (
            <span key={i} className={`pt${edge(i, sorted.length)}`} tabIndex={-1} style={{ insetInlineStart: `${x(p.at)}%`, bottom: `${y(p.value)}%` }}>
              <span className="tip">{valueLabel(p, shortDate(p.at, locale))}</span>
            </span>
          ))}
        </div>
      </div>
      <XLabels labels={[shortDate(sorted[0].at, locale), shortDate(sorted[sorted.length - 1].at, locale)]} />
      <DataTable head={[t("date"), seriesName]} rows={[...sorted].reverse().map((p) => [shortDate(p.at, locale), p.value])} />
    </figure>
  );
}

// Bars per period, one or two series side by side (for example verified / not verified bot visits per day).
// tone 1 = emerald, 2 = blue (validated for colour blindness, light and dark). Nothing to draw when every value is 0.
export type Series = { name: string; tone: 1 | 2; values: number[] };
export function BarChart({ periods, series, label, empty, periodLabel, tip }: { periods: string[]; series: Series[]; label: string; empty: React.ReactNode; periodLabel?: (p: string) => string; tip?: (i: number) => string }) {
  const locale = useLocale();
  const t = useTranslations("charts");
  if (!series.some((s) => s.values.some((v) => v > 0))) return <>{empty}</>;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const name = periodLabel ?? ((p: string) => shortDate(p, locale));
  const mid = Math.floor((periods.length - 1) / 2);
  return (
    <figure className="chart" aria-label={label}>
      <div className="chart-plot">
        <Axis max={max} />
        <div className="chart-area" aria-hidden="true">
          <div className="chart-grid"><i /><i /><i /></div>
          <div className="chart-bars">
            {periods.map((p, i) => (
              <div key={p} className={`col${edge(i, periods.length)}`} tabIndex={-1}>
                {series.map((s) => <span key={s.name} className={`bar s${s.tone}`} style={{ height: `${(s.values[i] / max) * 100}%` }} />)}
                <span className="tip">
                  <strong>{name(p)}</strong>
                  {tip ? <span>{tip(i)}</span> : series.map((s) => <span key={s.name}>{s.name}: {s.values[i]}</span>)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <XLabels labels={periods.length > 2 ? [name(periods[0]), name(periods[mid]), name(periods[periods.length - 1])] : periods.map(name)} />
      <DataTable head={[t("date"), ...series.map((s) => s.name)]} rows={periods.map((p, i) => [name(p), ...series.map((s) => s.values[i])]).filter((r) => r.slice(1).some((v) => Number(v) > 0)).reverse()} />
    </figure>
  );
}

export function Legend({ items }: { items: { name: string; tone?: 1 | 2; dashed?: boolean }[] }) {
  return (
    <div className="chart-legend">
      {items.map((i) => <span key={i.name}><i className={i.dashed ? "key-dashed" : `key s${i.tone ?? 1}`} />{i.name}</span>)}
    </div>
  );
}

// The funnel as horizontal steps: the first stage with a problem is highlighted, later ones are dimmed.
export type FunnelStep = { key: string; question: string; status: "ok" | "problem" | "unknown"; value: string; basis: "observed" | "heuristic" | "unavailable"; statusLabel: string; laterLabel?: string };
export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const breakAt = steps.findIndex((s) => s.status === "problem");
  return (
    <ol className="funnel-chart">
      {steps.map((s, i) => (
        <li key={s.key} className={`${s.status === "problem" && i === breakAt ? "problem" : s.status === "unknown" ? "unknown" : "ok"}${breakAt >= 0 && i > breakAt ? " after" : ""}`}>
          <span className="step-n" aria-hidden="true">{i + 1}</span>
          <div className="step-bar">
            <strong>{s.question}</strong>
            <span className="step-value">{s.value} <BasisBadge basis={s.basis} /> · {s.status === "problem" && i !== breakAt && s.laterLabel ? s.laterLabel : s.statusLabel}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

// Days from `from` to `to` (inclusive), as YYYY-MM-DD.
export function daysBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let d = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); d <= to.getTime(); d += 86_400_000) out.push(new Date(d).toISOString().slice(0, 10));
  return out;
}
// Monday of the ISO week of a date, as YYYY-MM-DD.
export const weekOf = (iso: string) => {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
