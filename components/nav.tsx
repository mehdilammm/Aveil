"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icons";

type Item = { label: string; path: string; icon: IconName };
// Grouped by what the merchant does: act, check readiness, see AI results, then reports.
const GROUPS: { group: string; items: Item[] }[] = [
  { group: "groupWork", items: [{ label: "overview", path: "", icon: "overview" }, { label: "fix", path: "/fix", icon: "fix" }, { label: "alerts", path: "/alerts", icon: "alert" }] },
  { group: "groupReadiness", items: [{ label: "readiness", path: "/readiness", icon: "readiness" }, { label: "markets", path: "/markets", icon: "market" }, { label: "feed", path: "/feed", icon: "feed" }, { label: "impact", path: "/impact", icon: "impact" }] },
  { group: "groupAi", items: [{ label: "visibility", path: "/visibility", icon: "visibility" }, { label: "traffic", path: "/traffic", icon: "traffic" }, { label: "bots", path: "/bots", icon: "bot" }, { label: "revenue", path: "/revenue", icon: "revenue" }] },
  { group: "groupMore", items: [{ label: "reports", path: "/reports", icon: "report" }] },
];
const BOTTOM: Item[] = [GROUPS[0].items[0], GROUPS[0].items[1], GROUPS[0].items[2], GROUPS[2].items[3]];

function useActive(storeId: string | null) {
  const pathname = usePathname();
  return (path: string) => {
    if (path === "/settings") return pathname.startsWith("/settings");
    const href = storeId ? `/stores/${storeId}${path}` : "#";
    return storeId !== null && (path === "" ? pathname === href : pathname.startsWith(href));
  };
}

export function Nav({ storeId, onNavigate }: { storeId: string | null; onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const active = useActive(storeId);
  return (
    <nav aria-label={t("main")} className="navlist">
      {GROUPS.map((g) => (
        <div key={g.group} className="navlist">
          <span className="nav-group">{t(g.group)}</span>
          {g.items.map((item) => (
            <Link key={item.label} href={storeId ? `/stores/${storeId}${item.path}` : "#"} aria-current={active(item.path) ? "page" : undefined} className={storeId ? undefined : "disabled"} onClick={onNavigate}>
              <Icon name={item.icon} /> {t(item.label)}
            </Link>
          ))}
        </div>
      ))}
      <Link href="/settings" aria-current={active("/settings") ? "page" : undefined} onClick={onNavigate}><Icon name="settings" /> {t("settings")}</Link>
    </nav>
  );
}

// Phone: the top bar's ☰ opens the full menu as a drawer; the bottom bar holds the four main pages and "More".
export function MobileNav({ storeId, children }: { storeId: string | null; children: React.ReactNode }) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const active = useActive(storeId);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" className="menu-button" aria-label={t("openMenu")} aria-expanded={open} onClick={() => setOpen(true)}><Icon name="menu" /></button>
      {open && (
        <>
          <div className="drawer-backdrop" onClick={() => setOpen(false)} />
          <div className="drawer" role="dialog" aria-modal="true" aria-label={t("main")}>
            <div className="drawer-head">
              <strong>AgentScope</strong>
              <button type="button" className="menu-button" aria-label={t("closeMenu")} onClick={() => setOpen(false)}><Icon name="close" /></button>
            </div>
            <Nav storeId={storeId} onNavigate={() => setOpen(false)} />
            {children}
          </div>
        </>
      )}
      <nav className="bottomnav" aria-label={t("quick")}>
        {BOTTOM.map((item) => (
          <Link key={item.label} href={storeId ? `/stores/${storeId}${item.path}` : "/settings"} aria-current={active(item.path) ? "page" : undefined}>
            <Icon name={item.icon} /> {t(`short.${item.label}`)}
          </Link>
        ))}
        <button type="button" onClick={() => setOpen(true)} aria-expanded={open}><Icon name="more" /> {t("more")}</button>
      </nav>
    </>
  );
}

export function StoreSwitch({ stores, storeId }: { stores: { id: string; name: string }[]; storeId: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("nav");
  if (stores.length < 2) return null;
  return (
    <div className="store-switch">
      <select
        aria-label={t("store")}
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
