import { NextResponse } from "next/server";
import { fixContext } from "@/lib/autofix";
import { applyImport, importPreview } from "@/lib/bulk-fixes";
import { MAX_BYTES } from "@/lib/bulk-import";
import { fixAccess } from "@/lib/fix-access";

export const runtime = "nodejs";
export const maxDuration = 300;

// Bulk GTIN / SKU / weight CSV import (G8). POST {csv, action: "preview"}: line by line, what would change.
// POST {csv, action: "apply", hash, confirm: true}: writes exactly the preview with that hash, in one batch.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await fixAccess((await params).id);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const body = (await request.json().catch(() => ({}))) as { csv?: unknown; action?: unknown; hash?: unknown; confirm?: unknown };
  const csv = typeof body.csv === "string" ? body.csv : "";
  if (!csv.trim()) return NextResponse.json({ error: "Choose a CSV file." }, { status: 400 });
  if (csv.length > MAX_BYTES) return NextResponse.json({ error: `The file is over ${MAX_BYTES / 1000} KB.` }, { status: 413 });
  const ctx = await fixContext(a.admin, a.store);
  try {
    if (body.action === "preview") {
      const p = await importPreview(ctx, csv);
      return p.ok ? NextResponse.json(p) : NextResponse.json({ error: p.reason }, { status: 400 });
    }
    if (body.action !== "apply" || body.confirm !== true || typeof body.hash !== "string") return NextResponse.json({ error: "Preview the file, then confirm." }, { status: 400 });
    const r = await applyImport(a.admin, ctx, csv, body.hash, a.userId);
    return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "The store could not be read." }, { status: 502 });
  }
}
