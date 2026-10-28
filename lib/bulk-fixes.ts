import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planAuto, type FixContext, type PlannedFix } from "./autofix";
import { previewImport, readImport, importPatch, type PreviewRow } from "./bulk-import";
import { fixFor } from "./fix-catalog";
import { fetchProductsFor, wooWrite } from "./woo";

type Finding = PlannedFix["finding"];
export const MAX_BULK = 50;
const ONE_CLICK: Record<string, string> = {
  sell_where_ship: "Sell only to the countries your shipping zones cover (WooCommerce → Settings → General → Selling locations).",
  guest_checkout: "Turn on guest checkout, so a buyer (or an agent acting for one) can pay without creating an account.",
};

// Bulk apply (G8): the auto and one-click fixes of the last scan, not applied yet, each with what it will change.
export function planBulk(ctx: FixContext, findings: Finding[], applied: Set<string>): PlannedFix[] {
  const open = findings.filter((f) => !applied.has(f.finding_key));
  const auto = planAuto(ctx, open);
  const oneClick = open.flatMap((f): PlannedFix[] => {
    const spec = fixFor(f);
    // The return policy (G7) needs its own preview of the text it is based on, so it is not in bulk.
    if (spec.type !== "one_click" || spec.kind === "returns") return [];
    return [{ finding: f, ...spec, ready: Boolean(ctx.write), reason: ctx.write ? null : "Add a write key first (Fix Center → Write access).", describe: ONE_CLICK[spec.kind] ?? spec.kind }];
  });
  return [...oneClick, ...auto];
}

export async function importPreview(ctx: FixContext, text: string): Promise<{ ok: true; rows: PreviewRow[]; hash: string; ready: number } | { ok: false; reason: string }> {
  const parsed = readImport(text);
  if (!parsed.ok) return parsed;
  const ids = [...new Set(parsed.lines.map((l) => l.id).filter((x): x is number => x !== null))];
  const skus = [...new Set(parsed.lines.map((l) => l.matchSku).filter((x): x is string => Boolean(x)))];
  const products = await fetchProductsFor(ctx.store.url, ctx.read, parsed.matchBy === "id" ? { ids } : { skus });
  return { ok: true, ...previewImport(parsed, products) };
}

// Writes the previewed changes (only if the store still matches the preview the merchant approved), one audit row
// per product with before / after, all in one batch so one Undo puts everything back.
export async function applyImport(admin: SupabaseClient, ctx: FixContext, text: string, hash: string, userId: string) {
  if (!ctx.write) return { ok: false as const, status: 400, error: "Add a write key first (Fix Center → Write access)." };
  const preview = await importPreview(ctx, text);
  if (!preview.ok) return { ok: false as const, status: 400, error: preview.reason };
  if (preview.hash !== hash) return { ok: false as const, status: 409, error: "The store or the file changed since the preview. Preview again." };
  const batchId = randomUUID();
  const results: { line: number; productId: number | null; status: "applied" | "failed"; error: string | null }[] = [];
  for (const row of preview.rows.filter((r) => r.status === "ok")) {
    const { patch, before } = importPatch(row);
    let error: string | null = null;
    try {
      await wooWrite(ctx.store.url, "PUT", `/products/${row.productId}`, patch, ctx.write);
    } catch (err) {
      error = (err instanceof Error ? err.message : "WooCommerce refused the change.").slice(0, 500);
    }
    const describe = `CSV import on product #${row.productId}: ${row.changes.map((c) => `${c.field} ${c.before || "(empty)"} → ${c.after}`).join(", ")}`.slice(0, 300);
    await admin.from("fix_audit_log").insert({
      store_id: ctx.store.id, owner_id: ctx.store.owner_id, batch_id: batchId, finding_key: `import:${row.productId}`, fix_type: "input", kind: "csv_import",
      channel: "write_key", target: `product:${row.productId}`, before: error ? null : before, after: error ? null : { ...patch, describe }, status: error ? "failed" : "applied", error, applied_by: userId, automatic: false,
    });
    results.push({ line: row.line, productId: row.productId, status: error ? "failed" : "applied", error });
  }
  return { ok: true as const, batchId, results };
}
