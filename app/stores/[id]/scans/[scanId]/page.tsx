import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, SeverityBadge } from "@/components/severity";
import { resolvedKeys } from "@/lib/history";
import { getUser } from "@/lib/supabase/server";

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

type Row = {
  finding_key: string;
  type: string;
  title: string;
  severity: string;
  evidence: string;
  guidance: string;
  product_id: number | null;
  basis: string;
  state: string | null;
};

const COLUMNS = "finding_key, type, title, severity, evidence, guidance, product_id, basis, state";

async function allFindings(supabase: Awaited<ReturnType<typeof getUser>>["supabase"], scanId: string) {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("findings").select(COLUMNS).eq("scan_id", scanId).range(from, from + 999);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) return rows;
  }
}

function editorUrl(storeUrl: string, productId: number | null) {
  return productId ? `${storeUrl}/wp-admin/post.php?post=${productId}&action=edit` : null;
}

export default async function ScanPage({ params }: { params: Promise<{ id: string; scanId: string }> }) {
  const { id, scanId } = await params;
  const { supabase } = await getUser();

  const [{ data: store }, { data: scan }] = await Promise.all([
    supabase.from("stores").select("id, name, url").eq("id", id).maybeSingle(),
    supabase.from("scans").select("id, status, created_at, finished_at, scanned_products, published_products, findings_count, error").eq("id", scanId).eq("store_id", id).maybeSingle(),
  ]);
  if (!store || !scan) notFound();

  const { data: prev } = await supabase
    .from("scans")
    .select("id, finished_at")
    .eq("store_id", id)
    .eq("status", "complete")
    .lt("created_at", scan.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const [current, previous] = await Promise.all([allFindings(supabase, scanId), prev ? allFindings(supabase, prev.id) : Promise.resolve([])]);
  const gone = new Set(resolvedKeys(new Set(current.map((f) => f.finding_key)), new Set(previous.map((f) => f.finding_key))));
  const resolved = previous.filter((f) => gone.has(f.finding_key));

  const sorted = [...current].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.product_id ?? 0) - (b.product_id ?? 0));
  const count = (state: string) => current.filter((f) => f.state === state).length;

  return (
    <>
      <p><Link href={`/stores/${store.id}`}>← {store.name}</Link></p>
      <h1>Scan findings</h1>
      <p className="muted">
        {formatDate(scan.finished_at)} · {scan.scanned_products ?? 0} products scanned · {scan.findings_count ?? 0} findings
      </p>
      {scan.error && <p className={scan.status === "failed" ? "error" : "muted"}>{scan.error}</p>}
      <p>
        {prev ? (
          <>Compared with the scan of {formatDate(prev.finished_at)}: <strong>{count("new")}</strong> new · <strong>{count("ongoing")}</strong> ongoing · <strong>{count("recurred")}</strong> recurred · <strong className="state-resolved">{resolved.length}</strong> resolved</>
        ) : (
          <span className="muted">First scan for this store. Run another scan after fixing issues to see what changed.</span>
        )}
      </p>

      {sorted.length === 0 && <p className="notice">No findings. Every scanned product passed the checks.</p>}
      {sorted.map((f) => {
        const editor = editorUrl(store.url, f.product_id);
        return (
          <div key={f.finding_key} className="card">
            <div className="row">
              <SeverityBadge severity={f.severity} />
              <strong>{f.title}</strong>
              <span className="muted">· {f.state}{f.basis === "heuristic" ? " · heuristic" : ""}</span>
            </div>
            <p>{f.evidence}</p>
            <p className="muted">{f.guidance}</p>
            {editor && <a href={editor} target="_blank" rel="noopener noreferrer">Edit product #{f.product_id}</a>}
          </div>
        );
      })}

      {resolved.length > 0 && (
        <>
          <h2>Resolved since the previous scan</h2>
          {resolved.map((f) => (
            <div key={f.finding_key} className="card">
              <div className="row">
                <span className="badge state-resolved">resolved</span>
                <strong>{f.title}</strong>
                {f.product_id && <span className="muted">· product #{f.product_id}</span>}
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}
