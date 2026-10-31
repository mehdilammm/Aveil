// Charts drawn as SVG on the server: no chart library, no client JavaScript. Every point is a real value passed in;
// a series with no data is never drawn (the caller shows an empty state instead).
import { BasisBadge } from "./badges";

export type Point = { at: string; value: number };

const W = 640;
const H = 200;
const PAD = { t: 16, r: 12, b: 28, l: 32 };
const niceMax = (v: number) => {
  if (v <= 5) return Math.max(1, Math.ceil(v));
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
};
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// Issues over time (one point per complete scan), with the days a fix was applied marked.
export function LineChart({ points, marks = [], label, valueLabel }: { points: Point[]; marks?: { at: string; label: string }[]; label: string; valueLabel: (p: Point) => string }) {
  const sorted = [...points].sort((a, b) => a.at.localeCompare(b.at));
  const t0 = Date.parse(sorted[0].at);
  const t1 = Math.max(Date.parse(sorted[sorted.length - 1].at), t0 + 1);
  const max = niceMax(Math.max(...sorted.map((p) => p.value)));
  const x = (at: string) => PAD.l + ((Date.parse(at) - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const path = sorted.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const ticks = [0, max / 2, max];
  const shownMarks = marks.filter((m) => Date.parse(m.at) >= t0 && Date.parse(m.at) <= t1);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} direction="ltr">
      {ticks.map((v) => (
        <g key={v}>
          <line className="axis" x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
          <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end">{Math.round(v)}</text>
        </g>
      ))}
      {shownMarks.map((m, i) => (
        <g key={i}>
          <line className="fix-mark" x1={x(m.at)} x2={x(m.at)} y1={PAD.t} y2={H - PAD.b} />
          <title>{m.label}</title>
        </g>
      ))}
      <path className="line" d={path} />
      {sorted.map((p, i) => (
        <circle key={i} className="dot" cx={x(p.at)} cy={y(p.value)} r={3.5}>
          <title>{valueLabel(p)}</title>
        </circle>
      ))}
      <text x={PAD.l} y={H - 8}>{shortDate(sorted[0].at)}</text>
      <text x={W - PAD.r} y={H - 8} textAnchor="end">{shortDate(sorted[sorted.length - 1].at)}</text>
    </svg>
  );
}

// Bars per period, one or two series side by side (for example verified / not verified bot visits per day).
export function BarChart({ periods, series, label }: { periods: string[]; series: { name: string; className: string; values: number[] }[]; label: string }) {
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const slot = (W - PAD.l - PAD.r) / periods.length;
  const bw = Math.max(2, Math.min(18, (slot * 0.8) / series.length));
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const every = Math.ceil(periods.length / 6);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} direction="ltr">
      {[0, max / 2, max].map((v) => (
        <g key={v}>
          <line className="axis" x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
          <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end">{Math.round(v)}</text>
        </g>
      ))}
      {periods.map((p, i) => (
        <g key={p}>
          {series.map((s, j) => (
            <rect key={s.name} className={s.className} x={PAD.l + i * slot + (slot - bw * series.length) / 2 + j * bw} y={y(s.values[i])} width={bw - 1} height={Math.max(0, H - PAD.b - y(s.values[i]))} rx={2}>
              <title>{`${shortDate(p)} · ${s.name}: ${s.values[i]}`}</title>
            </rect>
          ))}
          {i % every === 0 && <text x={PAD.l + i * slot + slot / 2} y={H - 8} textAnchor="middle">{shortDate(p)}</text>}
        </g>
      ))}
    </svg>
  );
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="chart-legend">
      {items.map((i) => <span key={i.name}><i style={{ background: i.color }} />{i.name}</span>)}
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
