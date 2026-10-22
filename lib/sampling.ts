// Smart sampling: which products get their page checked one by one. Best sellers first when the store has sales
// (WooCommerce total_sales); otherwise one product per category in turn, so every category is covered.
export type Sampleable = { id: number; permalink?: string | null; total_sales?: number | string | null; categories?: { id: number }[] | null };

export function pageUrlOf(storeUrl: string, p: Sampleable): string | null {
  try {
    const u = new URL(p.permalink ?? "");
    return u.protocol === "https:" && u.host === new URL(storeUrl).host ? u.toString() : null;
  } catch {
    return null;
  }
}

export type SampleBasis = "sales" | "category_coverage";

export function sampleProducts<T extends Sampleable>(storeUrl: string, products: T[], n: number): { items: T[]; basis: SampleBasis } {
  const usable = products.filter((p) => pageUrlOf(storeUrl, p)).sort((a, b) => a.id - b.id);
  const sales = (p: Sampleable) => Number(p.total_sales ?? 0) || 0;
  if (usable.some((p) => sales(p) > 0)) {
    return { items: [...usable].sort((a, b) => sales(b) - sales(a) || a.id - b.id).slice(0, n), basis: "sales" };
  }
  // Round robin over categories, biggest category first; products without a category come last.
  const byCat = new Map<number, T[]>();
  for (const p of usable) {
    const c = p.categories?.[0]?.id ?? -1;
    byCat.set(c, [...(byCat.get(c) ?? []), p]);
  }
  const queues = [...byCat.entries()].sort((a, b) => (a[0] === -1 ? 1 : b[0] === -1 ? -1 : b[1].length - a[1].length || a[0] - b[0])).map(([, q]) => [...q]);
  const out: T[] = [];
  while (out.length < n && queues.some((q) => q.length)) {
    for (const q of queues) {
      const p = q.shift();
      if (p && out.length < n) out.push(p);
    }
  }
  return { items: out, basis: "category_coverage" };
}
