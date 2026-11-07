import { NextResponse } from "next/server";
import { fixAccess } from "@/lib/fix-access";
import { cleanMarkets } from "@/lib/target-markets";

export const runtime = "nodejs";

// POST {markets: ["MA", "US"]}: the store's target markets (owner or admin). An empty list clears the choice, so
// AgentScope follows WooCommerce's Selling location(s) again. The next market check (scan, re-check) uses it.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await fixAccess((await params).id);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const body = (await request.json().catch(() => ({}))) as { markets?: unknown };
  const markets = cleanMarkets(body.markets);
  if (!markets) return NextResponse.json({ error: "markets must be a list." }, { status: 400 });
  const { error } = await a.admin.from("stores").update({ target_markets: markets.length ? markets : null }).eq("id", a.store.id);
  if (error) return NextResponse.json({ error: "Could not save." }, { status: 500 });
  return NextResponse.json({ markets: markets.length ? markets : null });
}
