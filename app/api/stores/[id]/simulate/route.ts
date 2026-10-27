import { NextResponse } from "next/server";
import { kickJobs } from "@/lib/job-kick";
import { marketOf } from "@/lib/markets";
import { isOwnershipVerified } from "@/lib/ownership-store";
import { lockedReason, storePlan } from "@/lib/plan-gate";
import { browserTestsToday } from "@/lib/browser-sim-run";
import { BROWSER_LIMITS } from "@/lib/browser-sim";
import { storeLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";

export const runtime = "nodejs";

// F7: queues one agent purchase test (never places an order). Verified stores only. mode "store_api" (default): one
// market through the Store API. mode "browser" (Pro): a real headless browser, at most 10 a store a day.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const store = await storeAccess(supabase, user.id, id);
  if (!store) return NextResponse.json({ error: "Store not found." }, { status: 404 });
  if (!canEdit(store.role)) return NextResponse.json({ error: "Viewers cannot run checks." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { market?: unknown; mode?: unknown };
  const browser = body.mode === "browser";
  const market = marketOf(body.market);
  if (!browser && !market) return NextResponse.json({ error: "Choose a market." }, { status: 400 });
  const admin = createAdminClient();
  if (!(await isOwnershipVerified(admin, store.id))) return NextResponse.json({ error: "Verify that you own this store first (store page → Ownership)." }, { status: 403 });
  if (browser && !(await storePlan(admin, store.id)).browserTests) return NextResponse.json({ error: lockedReason("browserTests") }, { status: 403 });
  const kind = browser ? "agent_sim_browser" : "agent_sim";
  const { data: open } = await admin.from("jobs").select("id").eq("store_id", store.id).eq("kind", kind).in("status", ["queued", "running"]).limit(1).maybeSingle();
  if (open) return NextResponse.json({ jobId: open.id });
  if (browser && (await browserTestsToday(admin, store.id)) >= BROWSER_LIMITS.perStoreDay) return NextResponse.json({ error: `At most ${BROWSER_LIMITS.perStoreDay} browser tests a store a day. Try again tomorrow (UTC).` }, { status: 429 });
  const limited = browser ? null : await storeLimit(admin, store.id, "simulate");
  if (limited) return NextResponse.json({ error: limited }, { status: 429 });
  const { data: job, error } = await admin.from("jobs").insert({ workspace_id: store.workspace_id, store_id: store.id, kind, max_attempts: 1, progress: browser ? {} : { market: market!.id }, created_by: user.id }).select("id").single();
  if (error || !job) return NextResponse.json({ error: "Could not start the test." }, { status: 500 });
  kickJobs();
  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
