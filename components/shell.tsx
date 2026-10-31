import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listStores } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { LanguageSwitch } from "./language-switch";
import { MobileNav, Nav, StoreSwitch } from "./nav";

// App frame for signed-in pages. storeId: the store being viewed, if any. Desktop: a full-height sidebar.
// Phone: a slim top bar (☰ opens the menu) and a bottom bar with the main pages.
export async function Shell({ storeId, children }: { storeId?: string; children: React.ReactNode }) {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const [stores, t] = await Promise.all([listStores(supabase), getTranslations("nav")]);
  const current = storeId ?? stores[0]?.id ?? null;
  const currentName = stores.find((s) => s.id === current)?.name;
  const account = (
    <div className="account">
      <StoreSwitch stores={stores.map(({ id, name }) => ({ id, name }))} storeId={current} />
      <span className="email">{user.email}</span>
      <form action="/auth/signout" method="post"><button type="submit" className="signout">{t("logout")}</button></form>
      <LanguageSwitch />
    </div>
  );

  return (
    <div className="shell">
      <header className="topbar">
        <MobileNav storeId={current}>{account}</MobileNav>
        <Link href="/" className="brand">AgentScope</Link>
        {currentName && <span className="store-name">{currentName}</span>}
      </header>
      <aside className="sidebar">
        <Link href="/" className="brand">AgentScope</Link>
        {currentName && <span className="store-name">{currentName}</span>}
        <Nav storeId={current} />
        {account}
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
