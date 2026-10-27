import { NextResponse } from "next/server";
import { kickJobs } from "@/lib/job-kick";
import { marketOf } from "@/lib/markets";
import { isOwnershipVerified } from "@/lib/ownership-store";
import { storeLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";

export const runtime = "nodejs";

// F7: queues one agent purchase test (Store API, never places an order) for one market. Verified stores only.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const store = await storeAccess(supabase, user.id, id);
  if (!store) return NextResponse.json({ error: "Store not found." }, { status: 404 });
  if (!canEdit(store.role)) return NextResponse.json({ error: "Viewers cannot run checks." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { market?: unknown };
  const market = marketOf(body.market);
  if (!market) return NextResponse.json({ error: "Choose a market." }, { status: 400 });
  const admin = createAdminClient();
  if (!(await isOwnershipVerified(admin, store.id))) return NextResponse.json({ error: "Verify that you own this store first (store page → Ownership)." }, { status: 403 });
  const { data: open } = await admin.from("jobs").select("id").eq("store_id", store.id).eq("kind", "agent_sim").in("status", ["queued", "running"]).limit(1).maybeSingle();
  if (open) return NextResponse.json({ jobId: open.id });
  const limited = await storeLimit(admin, store.id, "simulate");
  if (limited) return NextResponse.json({ error: limited }, { status: 429 });
  const { data: job, error } = await admin.from("jobs").insert({ workspace_id: store.workspace_id, store_id: store.id, kind: "agent_sim", max_attempts: 1, progress: { market: market.id }, created_by: user.id }).select("id").single();
  if (error || !job) return NextResponse.json({ error: "Could not start the test." }, { status: 500 });
  kickJobs();
  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
