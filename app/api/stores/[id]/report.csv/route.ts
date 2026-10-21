import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";
import { editorUrl, findingsForScan, getStore, listScans, sortForFixing } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Findings of the latest complete scan as CSV. Reads as the user, so RLS limits it to their own store.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const store = await getStore(supabase, id);
  if (!store) return NextResponse.json({ error: "Store not found." }, { status: 404 });

  const scan = (await listScans(supabase, id, 20)).find((s) => s.status === "complete");
  if (!scan) return NextResponse.json({ error: "No complete scan yet." }, { status: 404 });
  const findings = sortForFixing(await findingsForScan(supabase, scan.id));

  const csv = toCsv(
    ["severity", "label", "state", "title", "evidence", "guidance", "product_id", "link", "finding_key", "scan_finished_at"],
    findings.map((f) => [
      f.severity,
      f.basis.toUpperCase(),
      f.state ?? "",
      f.title,
      f.evidence,
      f.guidance,
      f.product_id ?? "",
      editorUrl(store.url, f)?.href ?? "",
      f.finding_key,
      scan.finished_at ?? "",
    ]),
  );
  const day = (scan.finished_at ?? scan.created_at).slice(0, 10);
  const slug = store.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "store";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="agentscope-${slug}-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
