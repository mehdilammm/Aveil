// Bulk GTIN / SKU / weight import (G8): a CSV the merchant wrote, checked line by line against the store's
// products before anything is written. Empty cells change nothing; values are written as given (after the same
// checks as a single input fix), never completed or guessed.
import { createHash } from "node:crypto";
import { checkInput } from "./fix-catalog";

export const MAX_ROWS = 200;
export const MAX_BYTES = 200_000;
export type ImportField = "gtin" | "sku" | "weight";
export const FIELD_KEY: Record<ImportField, "global_unique_id" | "sku" | "weight"> = { gtin: "global_unique_id", sku: "sku", weight: "weight" };
const HEADERS: Record<string, "id" | ImportField> = {
  product_id: "id", id: "id",
  sku: "sku",
  gtin: "gtin", ean: "gtin", upc: "gtin", barcode: "gtin", global_unique_id: "gtin",
  weight: "weight",
};

// RFC 4180: commas or semicolons, quoted cells with "" escapes, CRLF or LF.
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export type ImportLine = { line: number; id: number | null; matchSku: string | null; values: Partial<Record<ImportField, string>>; errors: string[] };
export type ParsedImport = { ok: true; matchBy: "id" | "sku"; fields: ImportField[]; lines: ImportLine[] } | { ok: false; reason: string };

export function readImport(text: string): ParsedImport {
  if (Buffer.byteLength(text) > MAX_BYTES) return { ok: false, reason: `The file is over ${MAX_BYTES / 1000} KB.` };
  const rows = parseCsv(text);
  if (rows.length < 2) return { ok: false, reason: "The file needs a header line and at least one product line." };
  if (rows.length - 1 > MAX_ROWS) return { ok: false, reason: `At most ${MAX_ROWS} product lines per file.` };
  const head = rows[0].map((h) => HEADERS[h.trim().toLowerCase().replace(/[\s-]+/g, "_")] ?? null);
  const idCol = head.indexOf("id");
  const matchBy = idCol >= 0 ? "id" : "sku";
  if (matchBy === "sku" && !head.includes("sku")) return { ok: false, reason: "Add a product_id column, or a sku column to match products by their SKU." };
  // Matched by SKU, the SKU column identifies the product; it is not a value to write.
  const fields = (["gtin", "sku", "weight"] as ImportField[]).filter((f) => head.includes(f) && !(f === "sku" && matchBy === "sku"));
  if (!fields.length) return { ok: false, reason: "No column to import: use gtin, sku or weight." };
  const col = (f: "id" | ImportField) => head.indexOf(f);

  const seenSku = new Map<string, number>();
  const seenProduct = new Map<string, number>();
  const lines: ImportLine[] = rows.slice(1).map((r, i) => {
    const line = i + 2;
    const cell = (f: "id" | ImportField) => (col(f) >= 0 ? (r[col(f)] ?? "").trim() : "");
    const errors: string[] = [];
    let id: number | null = null;
    let matchSku: string | null = null;
    if (matchBy === "id") {
      const raw = cell("id");
      if (/^\d{1,10}$/.test(raw) && Number(raw) > 0) id = Number(raw);
      else errors.push("product_id must be a whole number.");
    } else {
      matchSku = cell("sku") || null;
      if (!matchSku) errors.push("The sku cell is empty, so the product cannot be found.");
    }
    const key = id !== null ? `id:${id}` : matchSku ? `sku:${matchSku.toLowerCase()}` : null;
    if (key && seenProduct.has(key)) errors.push(`The same product is already on line ${seenProduct.get(key)}.`);
    else if (key) seenProduct.set(key, line);

    const values: ImportLine["values"] = {};
    for (const f of fields) {
      const v = cell(f);
      if (!v) continue;
      if (f === "sku") {
        if (v.length > 100 || [...v].some((ch) => ch.charCodeAt(0) < 32)) errors.push("A SKU has at most 100 characters, without line breaks.");
        else if (seenSku.has(v.toLowerCase())) errors.push(`SKU "${v}" is also on line ${seenSku.get(v.toLowerCase())}; each SKU must be unique.`);
        else { seenSku.set(v.toLowerCase(), line); values.sku = v; }
        continue;
      }
      const checked = checkInput(f, v);
      if (checked.ok) values[f] = checked.value;
      else errors.push(`${f === "gtin" ? "GTIN" : "Weight"}: ${checked.reason}`);
    }
    if (!errors.length && !Object.keys(values).length) errors.push("Nothing to change on this line.");
    return { line, id, matchSku, values, errors };
  });
  return { ok: true, matchBy, fields, lines };
}

export type ImportProduct = { id: number; name: string; sku?: string | null; global_unique_id?: string | null; weight?: string | null };
export type PreviewRow = {
  line: number;
  productId: number | null;
  name: string | null;
  status: "ok" | "same" | "error";
  reason: string | null;
  changes: { field: ImportField; before: string; after: string }[];
};

// Matches each line to a published product and lists the exact changes; `hash` pins what the merchant approves.
export function previewImport(parsed: Extract<ParsedImport, { ok: true }>, products: ImportProduct[]): { rows: PreviewRow[]; hash: string; ready: number } {
  const byId = new Map(products.map((p) => [p.id, p]));
  const bySku = new Map(products.filter((p) => p.sku).map((p) => [p.sku!.toLowerCase(), p]));
  const rows = parsed.lines.map((l): PreviewRow => {
    const p = l.id !== null ? byId.get(l.id) : l.matchSku ? bySku.get(l.matchSku.toLowerCase()) : undefined;
    const base = { line: l.line, productId: p?.id ?? l.id, name: p?.name ?? null, changes: [] };
    if (l.errors.length) return { ...base, status: "error", reason: l.errors.join(" ") };
    if (!p) return { ...base, status: "error", reason: l.id !== null ? `No published product #${l.id}.` : `No published product with SKU "${l.matchSku}".` };
    const changes = (Object.entries(l.values) as [ImportField, string][])
      .map(([field, after]) => ({ field, before: String(p[FIELD_KEY[field]] ?? ""), after }))
      .filter((c) => c.before !== c.after);
    if (!changes.length) return { ...base, status: "same", reason: "Already has these values." };
    return { ...base, status: "ok", reason: null, changes };
  });
  const ready = rows.filter((r) => r.status === "ok");
  const hash = createHash("sha256").update(JSON.stringify(ready.map((r) => [r.productId, r.changes]))).digest("hex");
  return { rows, hash, ready: ready.length };
}

// What the import writes on one product, and what undo puts back.
export function importPatch(row: PreviewRow): { patch: Record<string, string>; before: Record<string, string> } {
  const patch: Record<string, string> = {};
  const before: Record<string, string> = {};
  for (const c of row.changes) {
    patch[FIELD_KEY[c.field]] = c.after;
    before[FIELD_KEY[c.field]] = c.before;
  }
  return { patch, before };
}
