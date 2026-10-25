import { NextResponse } from "next/server";
import { storeLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";
import { rereadStoredAnswers } from "@/lib/visibility-run";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  // RLS returns the store only to members of its workspace; viewers can only read.
  const store = await storeAccess(supabase, user.id, id);
  if (!store) return NextResponse.json({ error: "Store not found." }, { status: 404 });
  if (!canEdit(store.role)) return NextResponse.json({ error: "Viewers cannot run checks. Ask a workspace admin." }, { status: 403 });
  const limited = await storeLimit(createAdminClient(), store.id, "reread");
  if (limited) return NextResponse.json({ error: limited }, { status: 429 });
  try {
    const result = await rereadStoredAnswers(createAdminClient(), store);
    return NextResponse.json(result, { status: result.error ? 409 : 200 });
  } catch (err) {
    console.error("visibility reread failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Re-reading failed because of a server problem." }, { status: 500 });
  }
}
