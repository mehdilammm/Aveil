import { NextResponse } from "next/server";
import { clientIp, hashIp, isFresh, withinRateLimit } from "@/lib/public-scan";
import { PublicFetcher } from "@/lib/public-fetch";
import { runPublicScan } from "@/lib/public-scan-run";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeStoreUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RUNNING_STALE_MS = 5 * 60_000;

// Public, no login. Returns the id of a fresh (≤ 24 h) report for the domain, or runs a new check.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const raw = typeof body?.url === "string" ? body.url.trim() : "";
  const parsed = normalizeStoreUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const u = new URL(parsed.url);
  const origin = `https://${u.host}`;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  const admin = createAdminClient();
  await admin.rpc("public_reports_cleanup");

  const { data: cached } = await admin
    .from("public_reports")
    .select("id, status, created_at")
    .eq("host", host)
    .in("status", ["complete", "running"])
    .order("created_at", { ascending: false })
    .limit(1);
  const last = cached?.[0];
  if (last && ((last.status === "complete" && isFresh(last.created_at, new Date())) || (last.status === "running" && Date.now() - Date.parse(last.created_at) < RUNNING_STALE_MS))) {
    return NextResponse.json({ id: last.id, cached: true });
  }

  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const { data: count, error: rateErr } = await admin.rpc("public_scan_hit", { p_ip_hash: hashIp(clientIp(request.headers), secret, new Date()), p_window_seconds: 3600 });
  if (rateErr) return NextResponse.json({ error: "Server error. Please try again." }, { status: 500 });
  if (!withinRateLimit(count as number)) return NextResponse.json({ error: "You can run 5 free checks per hour. Please try again later." }, { status: 429 });

  const { data: row, error } = await admin.from("public_reports").insert({ host, url: `${origin}/` }).select("id").single();
  if (error || !row) return NextResponse.json({ error: "Server error. Please try again." }, { status: 500 });

  try {
    const { report, usage, requests } = await runPublicScan(admin, origin, host, new PublicFetcher(undefined, await checkTokenForHost(admin, host)));
    await admin
      .from("public_reports")
      .update({
        status: "complete",
        report,
        finished_at: new Date().toISOString(),
        http_requests: requests,
        gemini_requests: usage.geminiRequests,
        gemini_input_tokens: usage.input,
        gemini_output_tokens: usage.output,
        mistral_requests: usage.mistral.requests,
        mistral_input_tokens: usage.mistral.input,
        mistral_output_tokens: usage.mistral.output,
      })
      .eq("id", row.id);
  } catch (err) {
    console.error("public check failed", err instanceof Error ? err.message : "unknown");
    await admin.from("public_reports").update({ status: "failed", error: "The check could not finish.", finished_at: new Date().toISOString() }).eq("id", row.id);
  }
  return NextResponse.json({ id: row.id });
}

// When a store on this host has a traffic connection, its token signs X-AgentScope-Check so the plugin skips the
// check's requests. Otherwise the header is the unsigned "1". The token never leaves the server.
async function checkTokenForHost(admin: ReturnType<typeof createAdminClient>, host: string): Promise<string | null> {
  const bare = host.replace(/^www\./, "");
  const { data: stores } = await admin.from("stores").select("id, url").ilike("url", `%${bare}%`).limit(20);
  for (const s of stores ?? []) {
    let h = "";
    try {
      h = new URL(s.url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (h !== bare) continue;
    const { data } = await admin.rpc("get_traffic_connector_secret", { p_store_id: s.id }).maybeSingle<{ token: string }>();
    if (data?.token) return data.token;
  }
  return null;
}
