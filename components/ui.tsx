// Shared building blocks (Milestone H): page head, stat strip, hero action, empty state, folded details.
import Link from "next/link";
import { BasisBadge } from "./badges";
import { Icon, type IconName } from "./icons";

export function PageHead({ title, sub, icon, action }: { title: React.ReactNode; sub?: React.ReactNode; icon?: IconName; action?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{icon && <Icon name={icon} />}{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {action && <div className="page-actions">{action}</div>}
    </div>
  );
}

// 3–4 big numbers. Each comes from real data; basis shows how it was measured, foot says from what.
export type Stat = { label: string; value: React.ReactNode; tone?: "good" | "warn" | "bad"; basis?: "observed" | "heuristic" | "unavailable"; foot?: React.ReactNode };
export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className="stat-strip">
      {stats.map((s, i) => (
        <div key={i} className={`stat${s.tone ? ` tone-${s.tone}` : ""}`}>
          <span className="value">{s.value}</span>
          <span className="label">{s.label}</span>
          {(s.basis || s.foot) && <span className="foot">{s.basis && <BasisBadge basis={s.basis} />}{s.foot}</span>}
        </div>
      ))}
    </div>
  );
}

export function HeroAction({ eyebrow, title, text, href, cta, done }: { eyebrow: string; title: React.ReactNode; text?: React.ReactNode; href?: string; cta?: string; done?: boolean }) {
  return (
    <section className={`hero-action${done ? " done" : ""}`}>
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {href && cta && <Link className="button" href={href}>{cta} <Icon name="arrow" size="sm" /></Link>}
    </section>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: IconName; title: React.ReactNode; text?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card empty">
      <span className="empty-icon"><Icon name={icon} /></span>
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {action && <div className="page-actions">{action}</div>}
    </div>
  );
}

export function Tech({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="tech">
      <summary>{label}</summary>
      {children}
    </details>
  );
}
