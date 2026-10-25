import { FORMULA_START } from "../csv";

// Factual description optimizer: the product's current description, kept as written, plus a "Details" list made
// only of what the store already has (category, attributes, size, weight, SKU, GTIN, brand, price) and what the
// merchant typed in. No model writes text here, so nothing can be invented. Missing facts buyers and agents look
// for are flagged, not filled.
export type ProductFacts = {
  id: number;
  name: string;
  description: string | null;
  short_description: string | null;
  categories: string[];
  attributes: { name: string; options: string[] }[];
  sku: string | null;
  gtin: string | null;
  brand: string | null;
  weight: string | null;
  dimensions: { length: string; width: string; height: string } | null;
  weightUnit: string | null;
  dimensionUnit: string | null;
};
export type MerchantInputs = Partial<Record<"material" | "use" | "care" | "warranty" | "included" | "other", string>>;
export const INPUT_FIELDS = ["material", "use", "care", "warranty", "included", "other"] as const;
export const MAX_INPUT = 300;

export type Draft = { html: string; lines: { label: string; value: string; source: "store" | "merchant" }[]; unknowns: string[] };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#8217;/g, "’").replace(/&quot;/g, '"').replace(/&#8211;/g, "–").replace(/&nbsp;/g, " ");
export const plain = (html: string | null) => decode((html ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

// The merchant's own words only: trimmed, single line, length-capped, no markup.
export function cleanInputs(raw: Record<string, unknown>): MerchantInputs {
  const out: MerchantInputs = {};
  for (const k of INPUT_FIELDS) {
    const v = typeof raw[k] === "string" ? (raw[k] as string).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_INPUT) : "";
    if (v) out[k] = v;
  }
  return out;
}

const LABEL: Record<(typeof INPUT_FIELDS)[number], string> = { material: "Material", use: "Use", care: "Care", warranty: "Warranty", included: "In the box", other: "Notes" };

export function buildDescription(p: ProductFacts, inputs: MerchantInputs): Draft {
  const lines: Draft["lines"] = [];
  const add = (label: string, value: string | null | undefined, source: "store" | "merchant") => {
    const v = (value ?? "").trim();
    if (v) lines.push({ label, value: decode(v), source });
  };
  add("Category", p.categories.map(decode).join(", "), "store");
  for (const a of p.attributes) add(decode(a.name), a.options.map(decode).join(", "), "store");
  const d = p.dimensions;
  if (d && [d.length, d.width, d.height].every((x) => x && Number(x) > 0)) add("Size", `${d.length} × ${d.width} × ${d.height}${p.dimensionUnit ? ` ${p.dimensionUnit}` : ""}`, "store");
  if (p.weight && Number(p.weight) > 0) add("Weight", `${p.weight}${p.weightUnit ? ` ${p.weightUnit}` : ""}`, "store");
  add("Brand", p.brand, "store");
  add("SKU", p.sku, "store");
  add("GTIN", p.gtin, "store");
  for (const k of INPUT_FIELDS) add(LABEL[k], inputs[k], "merchant");

  const has = (label: string) => lines.some((l) => l.label.toLowerCase() === label.toLowerCase());
  const attrNames = p.attributes.map((a) => a.name.toLowerCase());
  const unknowns = [
    !has("Size") && !attrNames.some((n) => /size|dimension|taille/.test(n)) && "size (length × width × height)",
    !has("Weight") && "weight",
    !has("Material") && !attrNames.some((n) => /material|matière|matiere/.test(n)) && "material",
    !has("Brand") && "brand",
    !has("GTIN") && "GTIN / EAN barcode (only if the product has one)",
    !has("Care") && "care instructions",
    !has("Warranty") && "warranty or guarantee",
    !plain(p.description) && "a description in your own words",
  ].filter(Boolean) as string[];

  const body = plain(p.description) || plain(p.short_description);
  const paragraphs = body ? body.split("\n").map((t) => `<p>${esc(t)}</p>`).join("\n") : "";
  const list = lines.length ? `<h3>Details</h3>\n<ul>\n${lines.map((l) => `<li><strong>${esc(l.label)}:</strong> ${esc(l.value)}</li>`).join("\n")}\n</ul>` : "";
  return { html: [paragraphs, list].filter(Boolean).join("\n"), lines, unknowns };
}

// Line diff (longest common subsequence) between the current and the proposed text, for the side-by-side view.
export type DiffRow = { kind: "same" | "removed" | "added"; text: string };
export function diffLines(a: string, b: string): DiffRow[] {
  const x = a.split("\n").filter((l) => l.trim());
  const y = b.split("\n").filter((l) => l.trim());
  const m = x.length;
  const n = y.length;
  const dp = Array.from({ length: m + 1 }, () => Array.from({ length: n + 1 }, () => 0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (x[i] === y[j]) {
      out.push({ kind: "same", text: x[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ kind: "removed", text: x[i++] });
    else out.push({ kind: "added", text: y[j++] });
  }
  while (i < m) out.push({ kind: "removed", text: x[i++] });
  while (j < n) out.push({ kind: "added", text: y[j++] });
  return out;
}

// WooCommerce product CSV import (Products → Import, "Update existing products"): ID and Description only.
export function descriptionsCsv(rows: { productId: number; html: string }[]): string {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  // A leading = + - @ would make a spreadsheet run it as a formula.
  const safe = (v: string) => (FORMULA_START.test(v) ? `'${v}` : v);
  return ["ID,Description", ...rows.map((r) => `${r.productId},${q(safe(r.html))}`)].join("\r\n") + "\r\n";
}
