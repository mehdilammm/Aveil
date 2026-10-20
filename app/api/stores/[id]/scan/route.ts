import { NextResponse } from "next/server";
import { runScan } from "@/lib/scan";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });

  // RLS returns the store only to its owner.
  const { data: store } = await supabase.from("stores").select("id, owner_id, url").eq("id", id).maybeSingle();
  if (!store || store.owner_id !== user.id) return NextResponse.json({ error: "Store not found." }, { status: 404 });

  const result = await runScan(createAdminClient(), store);
  return NextResponse.json(result, { status: result.error ? 409 : 200 });
}
