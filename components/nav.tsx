"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const ITEMS = [
  { label: "Overview", path: "" },
  { label: "AI Traffic", path: "/traffic" },
  { label: "Store Readiness", path: "/readiness" },
  { label: "Fix Center", path: "/fix" },
  { label: "AI Visibility", path: "/visibility" },
  { label: "Reports", path: "/reports" },
];

export function Nav({ storeId }: { storeId: string | null }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main">
      {ITEMS.map((item) => {
        const href = storeId ? `/stores/${storeId}${item.path}` : "#";
        const active = storeId !== null && (item.path === "" ? pathname === href : pathname.startsWith(href));
        return (
          <Link key={item.label} href={href} aria-current={active ? "page" : undefined} className={storeId ? undefined : "disabled"}>
            {item.label}
          </Link>
        );
      })}
      <Link href="/settings" aria-current={pathname.startsWith("/settings") ? "page" : undefined}>Settings</Link>
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
