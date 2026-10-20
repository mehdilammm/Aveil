import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate } from "@/components/severity";
import { getUser } from "@/lib/supabase/server";
import { RunScanButton } from "./run-scan-button";

export default async function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getUser();
  const { data: store } = await supabase.from("stores").select("id, name, url, connection_status").eq("id", id).maybeSingle();
  if (!store) notFound();

  const { data: scans } = await supabase
    .from("scans")
    .select("id, status, started_at, finished_at, published_products, scanned_products, findings_count, severity_counts, error")
    .eq("store_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <>
      <p><Link href="/stores">← Stores</Link></p>
      <h1>{store.name}</h1>
      <p className="muted">{store.url} · connection: {store.connection_status}</p>
      <RunScanButton storeId={store.id} />

      <h2>Scan history</h2>
      {scans?.length ? (
        <div className="table-wrap card">
          <table>
            <thead>
              <tr><th>Started</th><th>Status</th><th>Products</th><th>High</th><th>Medium</th><th>Low</th><th></th></tr>
            </thead>
            <tbody>
              {scans.map((s) => {
                const c = (s.severity_counts ?? {}) as Record<string, number>;
                return (
                  <tr key={s.id}>
                    <td>{formatDate(s.started_at)}</td>
                    <td>{s.status}{s.error && <div className={s.status === "failed" ? "error" : "muted"}>{s.error}</div>}</td>
                    <td>{s.scanned_products ?? "—"}{s.published_products != null && s.published_products !== s.scanned_products ? ` / ${s.published_products}` : ""}</td>
                    <td className="sev-high">{c.high ?? "—"}</td>
                    <td className="sev-medium">{c.medium ?? "—"}</td>
                    <td className="sev-low">{c.low ?? "—"}</td>
                    <td>{s.status === "complete" && <Link href={`/stores/${store.id}/scans/${s.id}`}>Findings</Link>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No scans yet. Run the first scan.</p>
      )}
    </>
  );
}
