import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runScan } from "@/lib/scan";
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

// Called daily by Vercel Cron (see vercel.json). Scans each store whose last complete scan is 7+ days old.
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not set; scheduled scans are off." }, { status: 503 });
  if (!authorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const started = Date.now();
  const now = new Date();
  const admin = createAdminClient();
  const { data: stores, error } = await admin.from("stores").select("id, owner_id, url").order("created_at");
  if (error) return NextResponse.json({ error: "Could not list stores" }, { status: 500 });

  const results: { storeId: string; scanId?: string; error?: string; skipped?: string }[] = [];
  for (const store of stores ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      results.push({ storeId: store.id, skipped: "time budget used; next run" });
      continue;
    }
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
      const r = await runScan(admin, store, "scheduled");
      results.push({ storeId: store.id, ...r });
    } catch (err) {
      console.error("scheduled scan failed", store.id, err instanceof Error ? err.message : "unknown");
      results.push({ storeId: store.id, error: "scan failed" });
    }
  }
  return NextResponse.json({ ran: results.filter((r) => r.scanId).length, results });
}
