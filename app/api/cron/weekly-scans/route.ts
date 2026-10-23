import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { JOB_HANDLERS } from "@/lib/job-handlers";
import { tick } from "@/lib/jobs";
import { enqueueScan } from "@/lib/scan";
import { dueForWeeklyScan } from "@/lib/schedule";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TIME_BUDGET_MS = 230_000;
const STALE_RUNNING_MS = 10 * 60_000;

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Called daily by Vercel Cron (see vercel.json). Queues a scan job for each store whose last complete scan is
// 7+ days old, then runs the queue for the rest of its time (pg_cron's minute tick does the same all day).
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not set; scheduled scans are off." }, { status: 503 });
  if (!authorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const started = Date.now();
  const now = new Date();
  const admin = createAdminClient();
  const { data: stores, error } = await admin.from("stores").select("id, owner_id, url, workspace_id").order("created_at");
  if (error) return NextResponse.json({ error: "Could not list stores" }, { status: 500 });

  const results: { storeId: string; jobId?: string; error?: string }[] = [];
  for (const store of stores ?? []) {
    const { data: scans } = await admin
      .from("scans")
      .select("status, trigger, created_at, finished_at")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .limit(30);
    const list = scans ?? [];
    const state = {
      storeId: store.id,
      lastCompleteAt: list.find((s) => s.status === "complete")?.finished_at ?? null,
      lastScheduledAt: list.find((s) => s.trigger === "scheduled")?.created_at ?? null,
      running: list.some((s) => (s.status === "running" || s.status === "queued") && Date.now() - Date.parse(s.created_at) < STALE_RUNNING_MS),
    };
    if (!dueForWeeklyScan(state, now)) continue;
    try {
      results.push({ storeId: store.id, ...(await enqueueScan(admin, store, "scheduled", null)) });
    } catch (err) {
      console.error("scheduled scan could not be queued", store.id, err instanceof Error ? err.message : "unknown");
      results.push({ storeId: store.id, error: "could not queue" });
    }
  }
  // Daily housekeeping jobs: the bots' IP lists, and old bot hits.
  await admin.from("jobs").insert([{ kind: "bot_ranges_refresh" }, { kind: "bot_hits_purge" }]);
  const ticked = await tick(admin, JOB_HANDLERS, Math.max(0, TIME_BUDGET_MS - (Date.now() - started))).catch(() => ({ ran: 0, results: [] }));
  return NextResponse.json({ queued: results.filter((r) => r.jobId && !r.error).length, results, ran: ticked.ran });
}
