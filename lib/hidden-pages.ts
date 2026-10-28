// G8: product, category and home pages hidden from search engines (and the AI search built on them) by mistake:
// a robots meta tag or X-Robots-Tag header with noindex / none, or a canonical link pointing to another address.
// The page markup is Observed; which tool printed it (Yoast SEO, Rank Math, the WordPress "discourage search
// engines" setting, the theme) is read from its markers and is Heuristic. AgentScope never adds noindex, so the fix
// is the setting in that tool (guidance): changing other plugins' settings is not one of the approved writes.
import { decodeEntities } from "./consistency";
import type { Finding } from "./rules";

export type HiddenPage = { url: string; html: string | null; headers?: Record<string, string> | null; kind: "home" | "product" | "category"; productId?: number | null };

const attr = (tag: string, name: string) => decodeEntities(new RegExp(`\\b${name}\\s*=\\s*(["'])([^"']*)\\1`, "i").exec(tag)?.[2] ?? "").trim();
export const normalizeUrl = (u: string) => {
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.host.toLowerCase()}${x.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return u;
  }
};
export const pathOfUrl = (u: string) => {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
};

export function robotsDirectives(html: string, headers?: Record<string, string> | null): { noindex: boolean; where: string[] } {
  const where: string[] = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = attr(m[0], "name").toLowerCase();
    if (["robots", "googlebot", "bingbot"].includes(name) && /\b(noindex|none)\b/i.test(attr(m[0], "content"))) where.push(`<meta name="${name}" content="${attr(m[0], "content")}">`);
  }
  const header = headers?.["x-robots-tag"] ?? "";
  if (/\b(noindex|none)\b/i.test(header)) where.push(`X-Robots-Tag: ${header}`);
  return { noindex: where.length > 0, where };
}

export function canonicalsOf(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*>/gi)].filter((m) => /\brel\s*=\s*["']?canonical/i.test(m[0])).map((m) => attr(m[0], "href")).filter(Boolean);
}

// Which tool printed the page's robots and canonical tags, from the markers each one leaves.
export function sourceOf(html: string, seoPlugins: string[]): { name: string; basis: "heuristic" } {
  if (/Yoast SEO plugin|yoast-schema-graph/i.test(html) || seoPlugins.some((p) => /yoast/i.test(p))) return { name: "Yoast SEO", basis: "heuristic" };
  if (/Rank Math|rank-math-schema/i.test(html) || seoPlugins.some((p) => /rank math/i.test(p))) return { name: "Rank Math", basis: "heuristic" };
  if (/<meta name='robots' content='[^']*noindex/i.test(html)) return { name: "WordPress", basis: "heuristic" };
  return { name: "the theme or another plugin", basis: "heuristic" };
}

const GUIDE: Record<string, { noindex: string; canonical: string }> = {
  "Yoast SEO": {
    noindex: "In WordPress, edit the product (or category) → Yoast SEO box → Advanced → \"Allow search engines to show this content in search results?\" → Yes. If every product is hidden, check Yoast SEO → Settings → Content types → Products → \"Show products in search results\".",
    canonical: "Edit the product → Yoast SEO box → Advanced → Canonical URL: leave it empty so the product's own address is used.",
  },
  "Rank Math": {
    noindex: "Edit the product (or category) → Rank Math box → Advanced → Robots Meta → choose Index. For all products: Rank Math → Titles & Meta → Products → Robots Meta.",
    canonical: "Edit the product → Rank Math box → Advanced → Canonical URL: leave it empty.",
  },
  WordPress: {
    noindex: "WordPress → Settings → Reading → untick \"Discourage search engines from indexing this site\" (it hides every page).",
    canonical: "WordPress prints the page's own address as canonical; another tool changed it. Look for an SEO or redirect setting.",
  },
  "the theme or another plugin": {
    noindex: "No SEO plugin marker was found: look for a \"noindex\" or \"search engine visibility\" option in the theme or in the plugins that edit page headers.",
    canonical: "No SEO plugin marker was found: look for a canonical URL option in the theme or a plugin.",
  },
};

export function hiddenFindings(pages: HiddenPage[], seoPlugins: string[]): Finding[] {
  const out: Finding[] = [];
  for (const p of pages) {
    if (!p.html) continue;
    const path = pathOfUrl(p.url);
    const src = sourceOf(p.html, seoPlugins);
    const what = p.kind === "product" ? "Product page" : p.kind === "category" ? "Category page" : "Home page";
    const r = robotsDirectives(p.html, p.headers);
    if (r.noindex) {
      out.push({
        finding_key: `hidden:noindex:${path}`,
        type: "page_noindex",
        product_id: p.productId ?? null,
        title: `${what} is hidden from search engines (noindex)`,
        severity: p.kind === "category" ? "medium" : "high",
        basis: "observed",
        evidence: `${p.url}: ${r.where.join("; ")}. Likely set by ${src.name} [Heuristic].`,
        guidance: `${GUIDE[src.name].noindex} Search engines and the AI search built on them leave noindex pages out.`,
        fix_url: p.url,
      });
    }
    const canonicals = [...new Set(canonicalsOf(p.html).map(normalizeUrl))];
    const own = normalizeUrl(p.url);
    if (canonicals.length > 1 || (canonicals.length === 1 && canonicals[0] !== own)) {
      out.push({
        finding_key: `hidden:canonical:${path}`,
        type: "page_canonical_elsewhere",
        product_id: p.productId ?? null,
        title: canonicals.length > 1 ? `${what} has ${canonicals.length} different canonical links` : `${what} says another address is the real one (canonical)`,
        severity: p.kind === "category" ? "low" : "medium",
        basis: "observed",
        evidence: `${p.url}: canonical ${canonicals.join(" and ")}. Likely set by ${src.name} [Heuristic].`,
        guidance: `${GUIDE[src.name].canonical} A canonical link to another address asks search engines to list that address instead of this page.`,
        fix_url: p.url,
      });
    }
  }
  return out;
}
