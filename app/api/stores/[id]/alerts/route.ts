import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";

export const runtime = "nodejs";

// POST {dismiss: id}: an owner or admin marks an alert as seen. Alerts are written by the server only.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const store = await storeAccess(supabase, user.id, id);
  if (!store) return NextResponse.json({ error: "Store not found." }, { status: 404 });
  if (!canEdit(store.role)) return NextResponse.json({ error: "Viewers cannot dismiss alerts." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { dismiss?: unknown };
  if (typeof body.dismiss !== "string") return NextResponse.json({ error: "Which alert?" }, { status: 400 });
  const { data, error } = await createAdminClient().from("store_alerts").update({ status: "dismissed", dismissed_at: new Date().toISOString(), dismissed_by: user.id }).eq("id", body.dismiss).eq("store_id", store.id).eq("status", "open").select("id");
  if (error) return NextResponse.json({ error: "Could not dismiss the alert." }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Alert not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
