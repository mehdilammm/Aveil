import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { AddStoreForm } from "./add-store-form";

export default async function StoresPage() {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const { data: stores } = await supabase.from("stores").select("id, name, url, connection_status").order("created_at");

  return (
    <>
      <h1>Your stores</h1>
      {stores?.length ? (
        stores.map((s) => (
          <div key={s.id} className="card">
            <Link href={`/stores/${s.id}`}><strong>{s.name}</strong></Link>
            <div className="muted">{s.url} · {s.connection_status}</div>
          </div>
        ))
      ) : (
        <p className="muted">No stores yet.</p>
      )}
      <h2>Add store</h2>
      <AddStoreForm />
    </>
  );
}
