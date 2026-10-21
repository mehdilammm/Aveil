import Link from "next/link";
import { listStores } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { AddStoreForm } from "./add-store-form";
import { DeleteStoreForm } from "./delete-store-form";

export default async function SettingsPage() {
  const { supabase } = await getUser();
  const stores = await listStores(supabase);

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <p className="sub">Your stores and their WooCommerce connection.</p>
      </div>

      <h2>Stores</h2>
      {stores.length === 0 && <p className="muted">No stores yet. Add your first store below.</p>}
      {stores.map((s) => (
        <div key={s.id} className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <Link href={`/stores/${s.id}`}><strong>{s.name}</strong></Link>
            <span className={`status-${s.connection_status}`}>{s.connection_status}</span>
          </div>
          <div className="muted">{s.url}</div>
          {s.connection_status === "error" && s.connection_error && <p className="error">Last error: {s.connection_error}</p>}
          <details>
            <summary className="muted">Delete this store</summary>
            <DeleteStoreForm storeId={s.id} storeName={s.name} />
          </details>
        </div>
      ))}

      <h2>Add store</h2>
      <AddStoreForm />
    </>
  );
}
