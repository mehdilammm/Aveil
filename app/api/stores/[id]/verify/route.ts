import { NextResponse } from "next/server";
import { kickJobs } from "@/lib/job-kick";
import { storeLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

// "Verify fix": queues a targeted re-check of one finding of the last complete scan.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const store = await storeAccess(supabase, user.id, id);
  if (!store) return NextResponse.json({ error: "Store not found." }, { status: 404 });
  if (!canEdit(store.role)) return NextResponse.json({ error: "Viewers cannot run checks." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { finding_key?: unknown };
  const key = typeof body.finding_key === "string" ? body.finding_key.slice(0, 300) : "";
  const admin = createAdminClient();
  const limited = await storeLimit(admin, store.id, "verify");
  if (limited) return NextResponse.json({ error: limited }, { status: 429 });
  const { data: scan } = await admin.from("scans").select("id").eq("store_id", store.id).eq("status", "complete").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: finding } = scan ? await admin.from("findings").select("finding_key").eq("scan_id", scan.id).eq("finding_key", key).maybeSingle() : { data: null };
  if (!scan || !finding) return NextResponse.json({ error: "This finding is not in the last scan." }, { status: 404 });
  const { data: open } = await admin.from("finding_verifications").select("job_id, status").eq("store_id", store.id).eq("finding_key", key).maybeSingle();
  if (open?.status === "running" && open.job_id) return NextResponse.json({ jobId: open.job_id });
  const { data: job, error } = await admin.from("jobs").insert({ workspace_id: store.workspace_id, store_id: store.id, kind: "verify_finding", max_attempts: 2, progress: { finding_key: key, scan_id: scan.id }, created_by: user.id }).select("id").single();
  if (error || !job) return NextResponse.json({ error: "Could not start the re-check." }, { status: 500 });
  await admin.from("finding_verifications").upsert({ store_id: store.id, owner_id: store.owner_id, finding_key: key, scan_id: scan.id, status: "running", evidence: null, attempts: 0, job_id: job.id, requested_by: user.id }, { onConflict: "store_id,finding_key" });
  kickJobs();
  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
