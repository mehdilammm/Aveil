import { NextResponse } from "next/server";
import { descriptionsCsv } from "@/lib/fixes/description";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// Approved descriptions as a WooCommerce product import CSV (ID, Description). Owners and admins.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const store = await storeAccess(supabase, user.id, id);
  if (!store || !canEdit(store.role)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const { data } = await supabase.from("description_drafts").select("product_id, proposed_html").eq("store_id", id).eq("status", "approved").order("product_id");
  const csv = descriptionsCsv((data ?? []).map((d) => ({ productId: Number(d.product_id), html: String(d.proposed_html) })));
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="descriptions-${id.slice(0, 8)}.csv"`, "Cache-Control": "no-store" } });
}
