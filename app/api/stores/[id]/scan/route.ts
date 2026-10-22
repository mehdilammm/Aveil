import { NextResponse } from "next/server";
import { kickJobs } from "@/lib/job-kick";
import { enqueueScan } from "@/lib/scan";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

// Queues the scan as a background job and starts it; the page follows it with /api/jobs/[id].
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });

  // RLS returns the store only to members of its workspace; viewers can only read.
  const store = await storeAccess(supabase, user.id, id);
  if (!store) return NextResponse.json({ error: "Store not found." }, { status: 404 });
  if (!canEdit(store.role)) return NextResponse.json({ error: "Viewers cannot run checks. Ask a workspace admin." }, { status: 403 });

  try {
    const result = await enqueueScan(createAdminClient(), store, "manual", user.id);
    kickJobs();
    return NextResponse.json(result, { status: result.error ? 409 : 202 });
  } catch (err) {
    console.error("scan route failed", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "The scan could not start because of a server problem. Please try again later." }, { status: 500 });
  }
}
