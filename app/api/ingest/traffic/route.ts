import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_BODY_BYTES, validateRows, verifySignature } from "@/lib/traffic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_LIMIT = 30; // requests per store per hour

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

// Receives daily traffic totals from the agentscope-core plugin. Headers:
// X-AgentScope-Store: store id, X-AgentScope-Timestamp: unix seconds,
// X-AgentScope-Signature: sha256=<hex HMAC-SHA256(token, "<timestamp>.<body>")>.
export async function POST(request: Request) {
  const storeId = request.headers.get("x-agentscope-store") ?? "";
  const timestamp = request.headers.get("x-agentscope-timestamp") ?? "";
  const signature = request.headers.get("x-agentscope-signature");
  if (!UUID_RE.test(storeId)) return fail(400, "Missing or invalid X-AgentScope-Store");

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return fail(413, "Body too large");
  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return fail(413, "Body too large");

  const admin = createAdminClient();
  const { data: allowed, error: rateErr } = await admin.rpc("traffic_rate_check", { p_store_id: storeId, p_limit: RATE_LIMIT, p_window_seconds: 3600 });
  if (rateErr) {
    console.error("ingest: rate check failed", rateErr.code);
    return fail(500, "Server error");
  }
  // Unknown stores and stores over the limit get the same answer, so store ids cannot be probed.
  if (!allowed) return fail(429, "Too many requests or unknown store");

  const { data: connector } = await admin
    .rpc("get_traffic_connector_secret", { p_store_id: storeId })
    .maybeSingle<{ owner_id: string; token: string }>();
  if (!connector || !verifySignature(connector.token, timestamp, body, signature, Math.floor(Date.now() / 1000))) {
    return fail(401, "Invalid signature");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return fail(400, "Body is not JSON");
  }
  const result = validateRows(parsed, new Date());
  if ("error" in result) return fail(422, result.error);

  if (result.rows.length) {
    // Each row is a daily total, so a resend replaces the earlier value instead of adding to it.
    const { error } = await admin.from("traffic_daily").upsert(
      result.rows.map((r) => ({ ...r, store_id: storeId, owner_id: connector.owner_id })),
      { onConflict: "store_id,day,source,category,confidence,route,http_status" },
    );
    if (error) {
      console.error("ingest: upsert failed", error.code, error.message);
      return fail(500, "Server error");
    }
  }
  await admin.from("traffic_connectors").update({ last_ingest_at: new Date().toISOString() }).eq("store_id", storeId);
  return NextResponse.json({ accepted: result.rows.length });
}
