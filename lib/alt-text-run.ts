import "server-only";
// G4: reads and writes for the alt text fix (write key). The rules are in alt-text.ts.
import { altProductOf, EMPTY_ALT_VIA_REST, imageUseOf, planAlt, storedAlt, type AltProduct, type ImageUse } from "./alt-text";
import { mapLimit } from "./scan";
import { fetchFeaturedMedia, fetchPublishedProduct, fetchPublishedProducts, fetchPublishedVariations, wooWrite, type WooCredentials } from "./woo";
import type { WooProduct } from "./rules";

type Store = { id: string; url: string };
export type AltWritten = { image: number; variation: number | null; alt: string };

// Which products show each image, across all published products and their variations. Kept two minutes so a batch
// of alt fixes (and their verify) reads the catalogue once.
const USE_TTL_MS = 120_000;
const useCache = new Map<string, { at: number; use: ImageUse }>();
export async function imageUse(store: Store, read: WooCredentials, fresh = false): Promise<ImageUse> {
  const hit = useCache.get(store.id);
  if (!fresh && hit && Date.now() - hit.at < USE_TTL_MS) return hit.use;
  const { items } = await fetchPublishedProducts(store.url, read);
  const products: AltProduct[] = await mapLimit(items, 4, async (p) => altProductOf(p, p.type === "variable" ? await fetchPublishedVariations(store.url, p.id, read) : []));
  const use = imageUseOf(products);
  useCache.set(store.id, { at: Date.now(), use });
  return use;
}

async function current(store: Store, read: WooCredentials, pid: number): Promise<{ product: WooProduct; alt: AltProduct }> {
  const product = await fetchPublishedProduct(store.url, read, pid);
  if (!product) throw new Error(`Product #${pid} is not published.`);
  const variations = product.type === "variable" ? await fetchPublishedVariations(store.url, pid, read) : [];
  return { product, alt: altProductOf(product, variations) };
}

// WooCommerce makes the first image it is sent the featured one: write the product's own images only when the
// first one listed is its featured image (else the product would change).
async function ownImagesWritable(store: Store, product: WooProduct): Promise<string | null> {
  const images = (product.images ?? []).filter((i) => i.id);
  if (!images.length) return null;
  const featured = await fetchFeaturedMedia(store.url, product.id);
  if (!featured.ok) return `${featured.reason} The product's own images are left as they are.`;
  if (featured.data !== images[0].id) return "The product has gallery images but no featured image, and WooCommerce would make the first one featured: its own images are left as they are.";
  return null;
}

const putOwnImages = (store: Store, product: WooProduct, alts: Map<number, string>, write: WooCredentials) =>
  wooWrite(store.url, "PUT", `/products/${product.id}`, { images: (product.images ?? []).filter((i) => i.id).map((i) => (alts.has(i.id) ? { id: i.id, alt: alts.get(i.id) } : { id: i.id })) }, write);

export async function applyAltFix(store: Store, read: WooCredentials, write: WooCredentials, pid: number): Promise<{ written: AltWritten[]; skipped: string[] }> {
  const { product, alt } = await current(store, read, pid);
  const plan = planAlt(alt, await imageUse(store, read));
  const skipped = plan.shared.map((s) => `image #${s.image} is used by products ${s.products.map((x) => `#${x}`).join(", ")}`);
  let writes = plan.writes;
  const own = writes.filter((w) => w.variation === null);
  if (own.length) {
    const blocked = await ownImagesWritable(store, product);
    if (blocked) {
      skipped.push(blocked);
      writes = writes.filter((w) => w.variation !== null);
    }
  }
  if (!writes.length) throw new Error(skipped.length ? `Nothing can be written: ${skipped.join("; ")}.` : "Every image of this product has alt text now.");
  const ownNow = writes.filter((w) => w.variation === null);
  if (ownNow.length) await putOwnImages(store, product, new Map(ownNow.map((w) => [w.image, w.alt])), write);
  for (const w of writes.filter((x) => x.variation !== null)) {
    await wooWrite(store.url, "PUT", `/products/${pid}/variations/${w.variation}`, { image: { id: w.image, alt: w.alt } }, write);
  }
  return { written: writes.map((w) => ({ image: w.image, variation: w.variation, alt: storedAlt(w.alt) })), skipped };
}

// Undo (by a person or by the auto-rollback): empties only the alt texts that still read what AgentScope wrote, on
// images still shown by that product or variation. Alt text the merchant changed since stays.
export async function revertAltFix(store: Store, read: WooCredentials, write: WooCredentials, pid: number, written: AltWritten[]): Promise<{ cleared: number; kept: string[] }> {
  const { product, alt } = await current(store, read, pid);
  const kept: string[] = [];
  const own = new Map<number, string>();
  const variations: AltWritten[] = [];
  for (const w of written) {
    const now = w.variation === null ? alt.images.find((i) => i.id === w.image) : alt.variations.find((v) => v.id === w.variation && v.image?.id === w.image)?.image;
    if (!now) kept.push(`image #${w.image} is no longer on ${w.variation === null ? "the product" : `variation #${w.variation}`}`);
    else if (now.alt.trim() !== w.alt) kept.push(`image #${w.image} alt text was changed since ("${now.alt.slice(0, 80)}")`);
    else if (w.variation === null) own.set(w.image, EMPTY_ALT_VIA_REST);
    else variations.push(w);
  }
  if (own.size) {
    const blocked = await ownImagesWritable(store, product);
    if (blocked) throw new Error(blocked);
    await putOwnImages(store, product, own, write);
  }
  for (const w of variations) await wooWrite(store.url, "PUT", `/products/${pid}/variations/${w.variation}`, { image: { id: w.image, alt: EMPTY_ALT_VIA_REST } }, write);
  return { cleared: own.size + variations.length, kept };
}

