import Link from "next/link";

// Tabs as links: the current one is marked for screen readers and styled as selected.
export function Tabs({ items, active, label }: { items: { href: string; label: string; key: string }[]; active: string; label: string }) {
  return (
    <nav className="tabs" aria-label={label}>
      {items.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === active ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}
