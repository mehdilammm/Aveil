import "server-only";
import { scanDeltas, type ScanDelta } from "./history";
import { weeklySummary, type WeeklySummary } from "./weekly";
import type { getUser } from "./supabase/server";

type Client = Awaited<ReturnType<typeof getUser>>["supabase"];

export type StoreRow = { id: string; name: string; url: string; connection_status: string; connection_error: string | null; workspace_id: string };
export type ScanRow = {
  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  published_products: number | null;
  scanned_products: number | null;
  findings_count: number | null;
  severity_counts: Record<string, number> | null;
  error: string | null;
  trigger: "manual" | "scheduled";
};
export type FindingRow = {
  finding_key: string;
  type: string;
  title: string;
  severity: "high" | "medium" | "low";
  evidence: string;
  guidance: string;
  product_id: number | null;
  basis: "observed" | "heuristic" | "unavailable";
  state: string | null;
  fix_url: string | null;
};

const SCAN_COLUMNS = "id, status, trigger, created_at, started_at, finished_at, published_products, scanned_products, findings_count, severity_counts, error";
const FINDING_COLUMNS = "finding_key, type, title, severity, evidence, guidance, product_id, basis, state, fix_url";

export async function listStores(supabase: Client) {
  const { data } = await supabase.from("stores").select("id, name, url, connection_status, connection_error, workspace_id").order("created_at");
  return (data ?? []) as StoreRow[];
}

export async function getStore(supabase: Client, id: string) {
  const { data } = await supabase.from("stores").select("id, name, url, connection_status, connection_error, workspace_id").eq("id", id).maybeSingle();
  return data as StoreRow | null;
}

export async function listScans(supabase: Client, storeId: string, limit = 50) {
  const { data } = await supabase.from("scans").select(SCAN_COLUMNS).eq("store_id", storeId).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as ScanRow[];
}

export async function findingsForScan(supabase: Client, scanId: string) {
  const rows: FindingRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("findings").select(FINDING_COLUMNS).eq("scan_id", scanId).range(from, from + 999);
    rows.push(...((data ?? []) as FindingRow[]));
    if (!data || data.length < 1000) return rows;
  }
}

// new / ongoing / recurred / resolved for each complete scan, keyed by scan id.
export async function deltasForScans(supabase: Client, scans: ScanRow[]): Promise<Map<string, ScanDelta>> {
  const complete = scans.filter((s) => s.status === "complete").reverse();
  if (!complete.length) return new Map();
  const keys = new Map<string, string[]>(complete.map((s) => [s.id, []]));
  const ids = complete.map((s) => s.id);
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("findings").select("scan_id, finding_key").in("scan_id", ids).range(from, from + 999);
    for (const f of data ?? []) keys.get(f.scan_id)?.push(f.finding_key);
    if (!data || data.length < 1000) break;
  }
  return new Map(scanDeltas(complete.map((s) => ({ id: s.id, keys: keys.get(s.id) ?? [] }))).map((d) => [d.scanId, d]));
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;
const BASIS_RANK = { observed: 0, heuristic: 1, unavailable: 2 } as const;

export function sortForFixing(findings: FindingRow[]) {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      BASIS_RANK[a.basis] - BASIS_RANK[b.basis] ||
      (a.product_id ?? 0) - (b.product_id ?? 0) ||
      a.finding_key.localeCompare(b.finding_key),
  );
}

export function editorUrl(storeUrl: string, f: Pick<FindingRow, "product_id" | "fix_url">) {
  if (f.product_id) return { href: `${storeUrl}/wp-admin/post.php?post=${f.product_id}&action=edit`, label: `Edit product #${f.product_id}` };
  if (f.fix_url) return { href: f.fix_url, label: "Open in WordPress" };
  return null;
}

// Weekly report for the store, with finding titles and types for display.
export async function weeklyReport(supabase: Client, scans: ScanRow[]): Promise<{ summary: WeeklySummary; titles: Map<string, string>; types: Map<string, string> } | null> {
  const complete = scans.filter((s) => s.status === "complete" && s.finished_at).reverse();
  if (complete.length < 2) return null;
  const keys = new Map<string, string[]>(complete.map((s) => [s.id, []]));
  const titles = new Map<string, string>();
  const types = new Map<string, string>();
  const ids = complete.map((s) => s.id);
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("findings").select("scan_id, finding_key, title, type").in("scan_id", ids).range(from, from + 999);
    for (const f of data ?? []) {
      keys.get(f.scan_id)?.push(f.finding_key);
      titles.set(f.finding_key, f.title);
      types.set(f.finding_key, f.type);
    }
    if (!data || data.length < 1000) break;
  }
  const summary = weeklySummary(complete.map((s) => ({ id: s.id, finishedAt: s.finished_at!, keys: keys.get(s.id) ?? [] })));
  return summary ? { summary, titles, types } : null;
}

// The store's queued or running job of this kind (started in the last 30 minutes), so a page can follow it.
export async function openJobId(supabase: Client, storeId: string, kind: "scan" | "visibility"): Promise<string | null> {
  const { data } = await supabase
    .from("jobs")
    .select("id")
    .eq("store_id", storeId)
    .eq("kind", kind)
    .in("status", ["queued", "running"])
    .gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0]?.id ?? null;
}
