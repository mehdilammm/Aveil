import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { NotVerifiedError } from "@/lib/agent-sim-run";
import { BrowserUnavailableError, runBrowserTest } from "@/lib/browser-sim-run";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 150;

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

// The only function that ships Chromium (next.config.ts). The queue's tick calls it for one agent_sim_browser job it
// has claimed (status running) and waits for the result; nothing else can start a browser here.
export async function POST(request: Request) {
  if (!authorized(request.headers.get("authorization"))) return new NextResponse(null, { status: 404 });
  const { jobId } = (await request.json().catch(() => ({}))) as { jobId?: unknown };
  if (typeof jobId !== "string") return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, kind, status, store_id").eq("id", jobId).maybeSingle();
  if (!job || job.kind !== "agent_sim_browser" || job.status !== "running" || !job.store_id) return NextResponse.json({ error: "No running browser job with this id." }, { status: 409 });
  const { data: store } = await admin.from("stores").select("id, url").eq("id", job.store_id).maybeSingle();
  if (!store) return NextResponse.json({ error: "store not found" }, { status: 409 });
  try {
    return NextResponse.json({ result: await runBrowserTest(admin, store, job.id) });
  } catch (err) {
    if (err instanceof NotVerifiedError) return NextResponse.json({ error: err.message, notVerified: true }, { status: 409 });
    if (err instanceof BrowserUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 });
    console.error("browser test failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: err instanceof Error ? err.message : "browser test failed" }, { status: 500 });
  }
}
