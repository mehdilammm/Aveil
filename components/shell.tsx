import Link from "next/link";
import { redirect } from "next/navigation";
import { listStores } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { Nav, StoreSwitch } from "./nav";

// App frame for signed-in pages. storeId: the store being viewed, if any.
export async function Shell({ storeId, children }: { storeId?: string; children: React.ReactNode }) {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const stores = await listStores(supabase);
  const current = storeId ?? stores[0]?.id ?? null;
  const currentName = stores.find((s) => s.id === current)?.name;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-row">
          <Link href="/" className="brand">AgentScope</Link>
          {stores.length === 1 && <span className="muted" style={{ color: "#b9d3c8", fontSize: 13 }}>{currentName}</span>}
        </div>
        <StoreSwitch stores={stores.map(({ id, name }) => ({ id, name }))} storeId={current} />
        <Nav storeId={current} />
        <form action="/auth/signout" method="post" className="account">
          <span className="email">{user.email}</span>
          <button type="submit">Log out</button>
        </form>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
