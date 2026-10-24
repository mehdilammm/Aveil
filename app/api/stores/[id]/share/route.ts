import { NextResponse } from "next/server";
import { findingsForScan } from "@/lib/data";
import { lockedReason, workspacePlan } from "@/lib/plan-gate";
import { buildSnapshot, newShareToken, SHARE_DAYS } from "@/lib/share-report";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";

export const runtime = "nodejs";
const MAX_ACTIVE = 20;

// Shareable report links (G3). POST {days} freezes the latest complete scan into a snapshot and returns the link
// once (only its hash is stored). POST {revoke: id} ends a link now. Owners and admins only.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const store = await storeAccess(supabase, user.id, id);
  if (!store) return NextResponse.json({ error: "Store not found." }, { status: 404 });
  if (!canEdit(store.role)) return NextResponse.json({ error: "Only owners and admins can share reports." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { days?: unknown; revoke?: unknown };
  const admin = createAdminClient();

  if (typeof body.revoke === "string") {
    const { data, error } = await admin.from("share_reports").update({ revoked_at: new Date().toISOString() }).eq("id", body.revoke).eq("store_id", store.id).is("revoked_at", null).select("id");
    if (error) return NextResponse.json({ error: "Could not revoke the link." }, { status: 500 });
    if (!data?.length) return NextResponse.json({ error: "Link not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  const plan = await workspacePlan(admin, store.workspace_id);
  if (!plan.shareReports) return NextResponse.json({ error: lockedReason("shareReports") }, { status: 403 });
  const days = Number(body.days);
  if (!(SHARE_DAYS as readonly number[]).includes(days)) return NextResponse.json({ error: "Choose 7, 30 or 90 days." }, { status: 400 });
  const now = new Date();
  const { count } = await admin.from("share_reports").select("id", { count: "exact", head: true }).eq("store_id", store.id).is("revoked_at", null).gt("expires_at", now.toISOString());
  if ((count ?? 0) >= MAX_ACTIVE) return NextResponse.json({ error: `A store can have ${MAX_ACTIVE} active links. Revoke one first.` }, { status: 429 });
  const { data: scan } = await admin.from("scans").select("id, finished_at, scanned_products").eq("store_id", store.id).eq("status", "complete").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!scan) return NextResponse.json({ error: "Run a complete scan first." }, { status: 409 });
  const findings = await findingsForScan(admin, scan.id);
  const { data: ws } = plan.clientReports ? await admin.from("workspaces").select("name, personal").eq("id", store.workspace_id).maybeSingle() : { data: null };
  const snapshot = buildSnapshot(store, scan, findings, ws && !ws.personal ? ws.name : undefined);
  const { token, hash } = newShareToken();
  const expires = new Date(now.getTime() + days * 86_400_000).toISOString();
  const { data: row, error } = await admin.from("share_reports").insert({ store_id: store.id, owner_id: store.owner_id, scan_id: scan.id, token_hash: hash, snapshot, created_by: user.id, expires_at: expires }).select("id").single();
  if (error || !row) return NextResponse.json({ error: "Could not create the link." }, { status: 500 });
  return NextResponse.json({ id: row.id, url: `${new URL(request.url).origin}/r/${token}`, expires_at: expires }, { status: 201 });
}
