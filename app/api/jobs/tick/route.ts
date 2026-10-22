import { NextResponse } from "next/server";
import { JOB_HANDLERS } from "@/lib/job-handlers";
import { tick } from "@/lib/jobs";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

// Called every minute by pg_cron + pg_net with the X-Jobs-Secret header (the secret lives in Supabase Vault).
// Without the right secret: 404, as if the route did not exist. With nothing queued: returns at once.
export async function POST(request: Request) {
  const secret = request.headers.get("x-jobs-secret") ?? "";
  if (secret.length < 32) return new NextResponse(null, { status: 404 });
  const admin = createAdminClient();
  const { data: ok } = await admin.rpc("jobs_tick_secret_matches", { p_secret: secret });
  if (ok !== true) return new NextResponse(null, { status: 404 });
  try {
    return NextResponse.json(await tick(admin, JOB_HANDLERS));
  } catch (err) {
    console.error("jobs tick failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "tick failed" }, { status: 500 });
  }
}
