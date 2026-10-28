// G4: empty product image alt text, filled with the product's own name (and the variation's options for an image
// only one variation shows). Opt-in per store (stores.alt_text_enabled), written with the store's write key.
// Rules (approved 2026-10-28): only empty alt text is written, an existing one is never replaced, the image is
// never described, and an image used by several products is left alone (its alt text has to fit all of them).
// Pure functions; the WooCommerce reads and writes are in autofix.ts.
import { decodeEntities } from "./consistency";
import type { Finding, WooProduct, WooVariation } from "./rules";

export type AltImage = { id: number; alt: string };
export type AltVariation = { id: number; image: AltImage | null; attributes: { name: string; option: string }[] };
export type AltProduct = { id: number; name: string; images: AltImage[]; variations: AltVariation[] };
// Image id → the products that show it (their own images and their variations' images).
export type ImageUse = Map<number, Set<number>>;
export type AltWrite = { image: number; alt: string; variation: number | null };
export type AltPlan = { writes: AltWrite[]; shared: { image: number; products: number[] }[] };

// From WooCommerce REST data. Placeholder images (id 0) are left out.
export function altProductOf(p: Pick<WooProduct, "id" | "name" | "images">, variations: WooVariation[]): AltProduct {
  return {
    id: p.id,
    name: p.name,
    images: (p.images ?? []).filter((i) => i.id).map((i) => ({ id: i.id, alt: i.alt ?? "" })),
    variations: variations.map((v) => ({ id: v.id, image: v.image?.id ? { id: v.image.id, alt: v.image.alt ?? "" } : null, attributes: (v.attributes ?? []).map((a) => ({ name: a.name, option: a.option ?? "" })) })),
  };
}

const MAX_ALT = 250;
const empty = (alt: string | null | undefined) => !(alt ?? "").trim();

export function imageUseOf(products: AltProduct[]): ImageUse {
  const use: ImageUse = new Map();
  const add = (image: number, product: number) => {
    if (!image) return; // WooCommerce's placeholder
    if (!use.has(image)) use.set(image, new Set());
    use.get(image)!.add(product);
  };
  for (const p of products) {
    for (const i of p.images) add(i.id, p.id);
    for (const v of p.variations) if (v.image) add(v.image.id, p.id);
  }
  return use;
}

// The alt text: the product name as the merchant wrote it, plus the options of the one variation the image is for.
export function altText(name: string, attributes: { name: string; option: string }[] = []): string {
  const base = decodeEntities(name).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const options = attributes.filter((a) => a.option?.trim()).map((a) => `${decodeEntities(a.name).trim()}: ${decodeEntities(a.option).trim()}`);
  const text = options.length ? `${base} – ${options.join(", ")}` : base;
  if (text.length <= MAX_ALT) return text;
  const cut = text.slice(0, MAX_ALT);
  return cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : MAX_ALT).trim();
}

// What would be written for one product now. An image in the product's own images gets the product name; an
// image only one variation shows gets the name and that variation's options; several variations: the name.
export function planAlt(p: AltProduct, use: ImageUse): AltPlan {
  const writes: AltWrite[] = [];
  const shared: AltPlan["shared"] = [];
  const seen = new Set<number>();
  const own = new Set(p.images.map((i) => i.id));
  const candidates: { image: AltImage; variation: AltVariation | null }[] = [
    ...p.images.map((image) => ({ image, variation: null })),
    ...p.variations.filter((v) => v.image).map((v) => ({ image: v.image!, variation: v })),
  ];
  for (const { image, variation } of candidates) {
    if (!image.id || seen.has(image.id)) continue;
    seen.add(image.id);
    if (!empty(image.alt)) continue;
    const users = use.get(image.id) ?? new Set([p.id]);
    if (users.size > 1) {
      shared.push({ image: image.id, products: [...users].sort((a, b) => a - b) });
      continue;
    }
    const showing = p.variations.filter((v) => v.image?.id === image.id);
    const one = !own.has(image.id) && showing.length === 1 ? showing[0] : null;
    const alt = altText(p.name, one?.attributes ?? []);
    if (!alt) continue;
    writes.push({ image: image.id, alt, variation: own.has(image.id) ? null : (variation ?? showing[0])?.id ?? null });
  }
  return { writes, shared };
}

export function altFindings(products: AltProduct[], use: ImageUse = imageUseOf(products)): Finding[] {
  const out: Finding[] = [];
  for (const p of products) {
    const { writes, shared } = planAlt(p, use);
    const sharedNote = shared.length ? ` ${shared.length} more ${shared.length === 1 ? "is" : "are"} used by several products (${shared.map((s) => `image #${s.image}: products ${s.products.map((x) => `#${x}`).join(", ")}`).join("; ")}) and ${shared.length === 1 ? "is" : "are"} left alone.` : "";
    if (writes.length) {
      out.push({
        finding_key: `image_alt_missing:${p.id}`,
        type: "image_alt_missing",
        product_id: p.id,
        title: writes.length === 1 ? "An image has no alt text" : `${writes.length} images have no alt text`,
        severity: "low",
        basis: "observed",
        evidence: `WooCommerce: image${writes.length === 1 ? "" : "s"} ${writes.map((w) => `#${w.image}`).join(", ")} of this product ${writes.length === 1 ? "has" : "have"} empty alt text.${sharedNote}`,
        guidance: "Auto-fix (opt-in): the product's name is written as the alt text (with the variation's options for a variation's own image). Only empty alt text is filled; it never describes the image and never replaces alt text you wrote. Or write your own in Media Library.",
      });
    } else if (shared.length) {
      out.push({
        finding_key: `image_alt_shared:${p.id}`,
        type: "image_alt_shared",
        product_id: p.id,
        title: shared.length === 1 ? "A shared image has no alt text" : `${shared.length} shared images have no alt text`,
        severity: "low",
        basis: "observed",
        evidence: `WooCommerce: ${shared.map((s) => `image #${s.image} (used by products ${s.products.map((x) => `#${x}`).join(", ")})`).join("; ")} has empty alt text.`,
        guidance: "These images are shown by several products, so AgentScope does not write one product's name on them. Write alt text that fits all of them in WordPress → Media Library.",
      });
    }
  }
  return out;
}

// What WooCommerce stores for an alt text sent through its REST API (wc_clean = sanitize_text_field): tags
// removed, whitespace collapsed and trimmed, percent-encoded characters removed. Used to compare after a write.
export function storedAlt(alt: string): string {
  let s = alt.replace(/<[^>]*>/g, "").replace(/[\r\n\t ]+/g, " ").trim();
  let found = false;
  while (/%[a-f0-9]{2}/i.test(s)) {
    s = s.replace(/%[a-f0-9]{2}/i, "");
    found = true;
  }
  return found ? s.replace(/ +/g, " ").trim() : s;
}

// WooCommerce only writes an alt text that is not empty, and stores it trimmed: a single space is how undo puts
// back an empty alt text through the same API.
export const EMPTY_ALT_VIA_REST = " ";
