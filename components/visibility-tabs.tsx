import Link from "next/link";

const TABS = [
  { label: "Questions & answers", path: "" },
  { label: "Brand profile", path: "/profile" },
  { label: "Share of voice", path: "/share" },
  { label: "Citations", path: "/citations" },
];

export function VisibilityTabs({ storeId, active }: { storeId: string; active: string }) {
  return (
    <p className="row small" style={{ gap: 12, flexWrap: "wrap" }}>
      {TABS.map((t) =>
        t.path === active ? (
          <strong key={t.path}>{t.label}</strong>
        ) : (
          <Link key={t.path} href={`/stores/${storeId}/visibility${t.path}`}>{t.label}</Link>
        ),
      )}
    </p>
  );
}
