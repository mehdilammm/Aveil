import { NextResponse } from "next/server";
import { validateHits } from "@/lib/bot-hits";
import { kickJobs } from "@/lib/job-kick";
import { createAdminClient } from "@/lib/supabase/admin";
import { isReplay } from "@/lib/rate-limit";
import { MAX_CLOCK_SKEW_SECONDS, verifySignature } from "@/lib/traffic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_LIMIT = 30; // requests per store per hour, shared with the traffic sends
const MAX_BODY = 512 * 1024;

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

// Receives batches of AI bot hits from the agentscope-core plugin, signed like the traffic sends:
// X-AgentScope-Store, X-AgentScope-Timestamp, X-AgentScope-Signature = sha256=<HMAC-SHA256(token, "<ts>.<body>")>.
// Each hit has its own id, so a resent batch is not counted twice. Identity is checked later by a job.
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
  // Replay of the same signed request inside the clock window: answered as already received, not stored again.
  if (await isReplay(admin, `${storeId}:${signature}`, 2 * MAX_CLOCK_SKEW_SECONDS)) return NextResponse.json({ ok: true, duplicate: true });

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return fail(400, "Body is not JSON");
  }
  const result = validateHits(parsed, new Date());
  if ("error" in result) return fail(422, result.error);
  if (result.hits.length) {
    const { error } = await admin.from("bot_hits").upsert(
      result.hits.map((h) => ({ ...h, store_id: storeId, owner_id: connector.owner_id })),
      { onConflict: "store_id,hit_id", ignoreDuplicates: true },
    );
    if (error) {
      console.error("bot hits: upsert failed", error.code);
      return fail(500, "Server error");
    }
    const { data: store } = await admin.from("stores").select("workspace_id").eq("id", storeId).maybeSingle();
    const { data: open } = await admin.from("jobs").select("id").eq("store_id", storeId).eq("kind", "bot_hits_verify").in("status", ["queued", "running"]).limit(1);
    if (store && !open?.length) {
      await admin.from("jobs").insert({ workspace_id: store.workspace_id, store_id: storeId, kind: "bot_hits_verify" });
      kickJobs();
    }
  }
  return NextResponse.json({ accepted: result.hits.length, skipped: result.skipped });
}
