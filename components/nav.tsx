"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";

const ITEMS = [
  { label: "overview", path: "" },
  { label: "traffic", path: "/traffic" },
  { label: "bots", path: "/bots" },
  { label: "readiness", path: "/readiness" },
  { label: "fix", path: "/fix" },
  { label: "visibility", path: "/visibility" },
  { label: "impact", path: "/impact" },
  { label: "revenue", path: "/revenue" },
  { label: "reports", path: "/reports" },
];

export function Nav({ storeId }: { storeId: string | null }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  return (
    <nav aria-label="Main">
      {ITEMS.map((item) => {
        const href = storeId ? `/stores/${storeId}${item.path}` : "#";
        const active = storeId !== null && (item.path === "" ? pathname === href : pathname.startsWith(href));
        return (
          <Link key={item.label} href={href} aria-current={active ? "page" : undefined} className={storeId ? undefined : "disabled"}>
            {t(item.label)}
          </Link>
        );
      })}
      <Link href="/settings" aria-current={pathname.startsWith("/settings") ? "page" : undefined}>{t("settings")}</Link>
    </nav>
  );
}

export function StoreSwitch({ stores, storeId }: { stores: { id: string; name: string }[]; storeId: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  if (stores.length < 2) return null;
  return (
    <div className="store-switch">
      <select
        aria-label="Store"
        value={storeId ?? ""}
        onChange={(e) => {
          const rest = storeId ? pathname.replace(`/stores/${storeId}`, "").replace(/^\/scans\/.*/, "") : "";
          router.push(`/stores/${e.target.value}${rest}`);
        }}
      >
        {stores.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </div>
  );
}
