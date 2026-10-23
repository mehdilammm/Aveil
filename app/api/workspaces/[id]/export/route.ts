import { NextResponse } from "next/server";
import { exportWorkspace } from "@/lib/data-export";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// The workspace owner downloads everything the workspace holds (no secrets), as JSON.
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const { data: m } = await supabase.from("workspace_members").select("role").eq("workspace_id", id).eq("user_id", user.id).maybeSingle();
  if (m?.role !== "owner") return NextResponse.json({ error: "Only the workspace owner can export its data." }, { status: 403 });
  const data = await exportWorkspace(createAdminClient(), id);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="agentscope-workspace-${id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" },
  });
}
