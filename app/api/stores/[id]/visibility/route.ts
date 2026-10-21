import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { runVisibility } from "@/lib/visibility-run";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const { data: store } = await supabase.from("stores").select("id, owner_id, name, url").eq("id", id).maybeSingle();
  if (!store || store.owner_id !== user.id) return NextResponse.json({ error: "Store not found." }, { status: 404 });
  try {
    const result = await runVisibility(createAdminClient(), store);
    return NextResponse.json(result, { status: result.error && !result.runId ? 409 : 200 });
  } catch (err) {
    console.error("visibility run failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "The run could not complete because of a server problem." }, { status: 500 });
  }
}
