import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// A job's status for the page that queued it. RLS: members of the store's workspace only.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const { data: job } = await supabase.from("jobs").select("id, kind, status, attempt, max_attempts, progress, error, updated_at").eq("id", id).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  return NextResponse.json(job, { headers: { "Cache-Control": "no-store" } });
}
