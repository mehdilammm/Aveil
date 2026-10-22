import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";
import { visibilityPrecheck } from "@/lib/visibility-run";
import { kickJobs } from "@/lib/job-kick";
import { groundingFlag } from "@/lib/grounding";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  // RLS returns the store only to members of its workspace; viewers can only read.
  const store = await storeAccess(supabase, user.id, id);
  if (!store) return NextResponse.json({ error: "Store not found." }, { status: 404 });
  if (!canEdit(store.role)) return NextResponse.json({ error: "Viewers cannot run checks. Ask a workspace admin." }, { status: 403 });
  // { test: true }: "Re-run with citations (test)", workspace owner only, grounding must be on.
  const body = (await request.json().catch(() => ({}))) as { test?: unknown };
  const test = body?.test === true;
  if (test && store.role !== "owner") return NextResponse.json({ error: "Only the workspace owner can start a test run." }, { status: 403 });
  if (test && !groundingFlag().enabled) return NextResponse.json({ error: `Grounding is off on the server (GEMINI_GROUNDING_ENABLED is ${groundingFlag().read}).` }, { status: 409 });
  try {
    const admin = createAdminClient();
    const refused = await visibilityPrecheck(admin, store, { test });
    if (refused) return NextResponse.json(refused, { status: 409 });
    const { data: open } = await admin.from("jobs").select("id").eq("store_id", store.id).eq("kind", "visibility").in("status", ["queued", "running"]).gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString()).limit(1);
    if (open?.length) return NextResponse.json({ jobId: open[0].id, error: "A run is already in progress." }, { status: 409 });
    const { data: job, error } = await admin.from("jobs").insert({ workspace_id: store.workspace_id, store_id: store.id, kind: "visibility", progress: { test }, created_by: user.id }).select("id").single();
    if (error || !job) throw error ?? new Error("could not queue the run");
    kickJobs();
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (err) {
    console.error("visibility run failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "The run could not complete because of a server problem." }, { status: 500 });
  }
}
