import { NextResponse } from "next/server";
import { kickJobs } from "@/lib/job-kick";
import { planOf } from "@/lib/orders-sync";
import { PLANS } from "@/lib/plans";
import { isReplay } from "@/lib/rate-limit";
import { isBreakageKind, validateEvents } from "@/lib/store-events";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_CLOCK_SKEW_SECONDS, verifySignature } from "@/lib/traffic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_LIMIT = 30; // requests per store per hour, shared with the traffic sends
const MAX_BODY = 64 * 1024;
const BREAKAGE_DELAY_MS = 2 * 60_000; // let caches and the update settle before the mini-scan
const PRODUCT_GAP_MS = 5 * 60_000; // one check per product every 5 minutes at most

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

// Plugin 1.7.0 (F2 / F3): store changes, sent by WP-Cron with the same signature as the traffic sends
// (X-AgentScope-Store, X-AgentScope-Timestamp, X-AgentScope-Signature). Stored once per event id; a plugin /
// theme / core change queues one breakage check (Pro and Agency), a product publish / update queues one product
// check (every plan; auto-fix only on Pro and Agency).
export async function POST(request: Request) {
  const storeId = request.headers.get("x-agentscope-store") ?? "";
  const timestamp = request.headers.get("x-agentscope-timestamp") ?? "";
  const signature = request.headers.get("x-agentscope-signature");
  if (!UUID_RE.test(storeId)) return fail(400, "Missing or invalid X-AgentScope-Store");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return fail(413, "Body too large");
  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_BODY) return fail(413, "Body too large");

  const admin = createAdminClient();
  const { data: allowed, error: rateErr } = await admin.rpc("traffic_rate_check", { p_store_id: storeId, p_limit: RATE_LIMIT, p_window_seconds: 3600 });
  if (rateErr) return fail(500, "Server error");
  if (!allowed) return fail(429, "Too many requests or unknown store");
  const { data: connector } = await admin.rpc("get_traffic_connector_secret", { p_store_id: storeId }).maybeSingle<{ owner_id: string; token: string }>();
  if (!connector || !verifySignature(connector.token, timestamp, body, signature, Math.floor(Date.now() / 1000))) return fail(401, "Invalid signature");
  if (await isReplay(admin, `${storeId}:${signature}`, 2 * MAX_CLOCK_SKEW_SECONDS)) return NextResponse.json({ ok: true, duplicate: true });

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return fail(400, "Body is not JSON");
  }
  const result = validateEvents(parsed, new Date());
  if ("error" in result) return fail(422, result.error);
  if (!result.events.length) return NextResponse.json({ accepted: 0, skipped: result.skipped });

  const { data: inserted, error } = await admin
    .from("store_events")
    .upsert(result.events.map((e) => ({ ...e, store_id: storeId, owner_id: connector.owner_id })), { onConflict: "store_id,event_id", ignoreDuplicates: true })
    .select("event_id, kind, product_id");
  if (error) {
    console.error("store events: upsert failed", error.code);
    return fail(500, "Server error");
  }
  const fresh = (inserted ?? []) as { event_id: string; kind: string; product_id: number | null }[];
  const { data: store } = await admin.from("stores").select("workspace_id").eq("id", storeId).maybeSingle();
  const plan = PLANS[await planOf(admin, storeId)];
  const jobs: { event_ids: string[]; row: Record<string, unknown> }[] = [];
  const now = Date.now();

  const breakage = fresh.filter((e) => isBreakageKind(e.kind)).map((e) => e.event_id);
  if (store && breakage.length && plan.breakageAlerts) {
    const { data: open } = await admin.from("jobs").select("id, progress").eq("store_id", storeId).eq("kind", "breakage_check").eq("status", "queued").limit(1).maybeSingle();
    if (open) {
      // A check is already waiting: it covers these changes too.
      const ids = [...new Set([...((open.progress?.event_ids as string[] | undefined) ?? []), ...breakage])];
      await admin.from("jobs").update({ progress: { ...open.progress, event_ids: ids } }).eq("id", open.id);
      await admin.from("store_events").update({ job_id: open.id }).eq("store_id", storeId).in("event_id", breakage);
    } else {
      jobs.push({ event_ids: breakage, row: { workspace_id: store.workspace_id, store_id: storeId, kind: "breakage_check", status: "queued", run_after: new Date(now + BREAKAGE_DELAY_MS).toISOString(), max_attempts: 2, progress: { event_ids: breakage } } });
    }
  }
  const byProduct = new Map<number, string[]>();
  for (const e of fresh) if (e.product_id) byProduct.set(e.product_id, [...(byProduct.get(e.product_id) ?? []), e.event_id]);
  for (const [productId, ids] of byProduct) {
    if (!store) break;
    const { data: recent } = await admin.from("jobs").select("id").eq("store_id", storeId).eq("kind", "product_check").contains("progress", { product_id: productId }).gte("created_at", new Date(now - PRODUCT_GAP_MS).toISOString()).limit(1);
    if (recent?.length) continue;
    jobs.push({ event_ids: ids, row: { workspace_id: store.workspace_id, store_id: storeId, kind: "product_check", status: "queued", max_attempts: 2, progress: { product_id: productId, event_ids: ids } } });
  }
  for (const j of jobs) {
    const { data: job } = await admin.from("jobs").insert(j.row).select("id").single();
    if (job) await admin.from("store_events").update({ job_id: job.id }).eq("store_id", storeId).in("event_id", j.event_ids);
  }
  if (jobs.length) kickJobs();
  return NextResponse.json({ accepted: fresh.length, skipped: result.skipped, checks: jobs.length });
}
