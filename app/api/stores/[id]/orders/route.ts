import { NextResponse } from "next/server";
import { planOf, syncOrders } from "@/lib/orders-sync";
import { PLANS } from "@/lib/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 120;

// "Refresh orders": reads the last 90 days of orders again (Pro and Agency, owners and admins).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const store = await storeAccess(supabase, user.id, id);
  if (!store) return NextResponse.json({ error: "Store not found." }, { status: 404 });
  if (!canEdit(store.role)) return NextResponse.json({ error: "Viewers cannot refresh orders." }, { status: 403 });
  const admin = createAdminClient();
  if (!PLANS[await planOf(admin, store.id)].aiRevenue) return NextResponse.json({ error: "AI-referred orders are available on Pro and Agency." }, { status: 403 });
  const { data: creds } = await admin.rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: store.owner_id }).maybeSingle<{ consumer_key: string; consumer_secret: string }>();
  if (!creds) return NextResponse.json({ error: "No API key saved for this store." }, { status: 409 });
  try {
    const r = await syncOrders(admin, store, { consumerKey: creds.consumer_key, consumerSecret: creds.consumer_secret });
    return NextResponse.json(r);
  } catch (err) {
    console.error("orders refresh failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Orders could not be read. Please try again." }, { status: 500 });
  }
}
