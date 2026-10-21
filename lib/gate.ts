// Coming soon / maintenance detection. A store that shows visitors a placeholder page cannot be
// tested for agent access or structured data, so those checks become unavailable instead of failing.
import type { Source } from "./pages";
import type { Finding } from "./rules";
import type { PageFetch } from "./woo";

export type Gate = { kind: "coming_soon" | "maintenance"; reason: string };

// WooCommerce prints this meta tag on its Coming soon page (ComingSoonRequestHandler).
const WOO_COMING_SOON_RE = /<meta[^>]+name\s*=\s*["']woo-coming-soon-page["'][^>]*content\s*=\s*["']yes["']/i;
const TITLE_RE = /<title[^>]*>\s*(coming soon|under construction|maintenance mode|site is under maintenance|briefly unavailable for scheduled maintenance)/i;
const BODY_CLASS_RE = /<body[^>]+class\s*=\s*["'][^"']*\b(woocommerce-coming-soon[\w-]*|coming-soon-page|maintenance-mode)\b/i;
// The Coming soon block. With classic (non-block) themes WooCommerce prints the page header before it adds
// the meta tag, so the meta is missing and this block class is the only marker (e.g. matha.site product pages).
const WOO_BLOCK_RE = /class\s*=\s*["'][^"']*\bwp-block-woocommerce-coming-soon\b/i;
const TITLE_TEXT_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

// Short, factual description of what a page returned, for evidence.
export function describePage(f: PageFetch): string {
  if (!f.ok) return f.skipped ? f.error : `no answer (${f.error})`;
  if (f.redirectedTo) return `HTTP ${f.status}, redirect to ${f.redirectedTo}`;
  const title = TITLE_TEXT_RE.exec(f.body)?.[1].replace(/\s+/g, " ").trim().slice(0, 80) ?? "";
  return [
    `HTTP ${f.status}`,
    title ? `title "${title}"` : "no title",
    `coming-soon meta: ${WOO_COMING_SOON_RE.test(f.body) ? "yes" : "no"}`,
    `coming-soon block: ${WOO_BLOCK_RE.test(f.body) ? "yes" : "no"}`,
    `${Math.round(f.bytes / 1024)} KB`,
  ].join(", ");
}

export function pageGate(f: PageFetch): Gate | null {
  if (!f.ok) return null;
  if (WOO_COMING_SOON_RE.test(f.body) || WOO_BLOCK_RE.test(f.body)) {
    return { kind: "coming_soon", reason: `the page shows the WooCommerce Coming soon screen to visitors (${describePage(f)})` };
  }
  if (f.status === 503) return { kind: "maintenance", reason: "the page answers HTTP 503 (maintenance or unavailable)" };
  const title = TITLE_RE.exec(f.body);
  if (title) {
    const maintenance = /maintenance/i.test(title[1]);
    return { kind: maintenance ? "maintenance" : "coming_soon", reason: `the page title is "${title[1].trim()}"` };
  }
  if (BODY_CLASS_RE.test(f.body)) return { kind: "coming_soon", reason: "the page is a coming soon or maintenance template" };
  return null;
}

export type ComingSoonSetting = { comingSoon: boolean; storePagesOnly: boolean };

// Gate from the WooCommerce setting alone, so a page is not tested even when its markup has no marker.
// "Store pages only" covers shop, product, cart and checkout pages; otherwise the whole site.
export function settingGate(setting: Source<ComingSoonSetting>, page: "home" | "product"): Gate | null {
  if (!setting.ok || !setting.data.comingSoon) return null;
  if (page === "home" && setting.data.storePagesOnly) return null;
  return {
    kind: "coming_soon",
    reason: `WooCommerce site visibility is Coming soon (${setting.data.storePagesOnly ? "store pages only" : "whole site"}), so visitors and agents do not see this page`,
  };
}

// One store-level note when the store is closed to visitors, from the setting or from the pages themselves.
export function checkStoreGate(storeUrl: string, setting: Source<ComingSoonSetting>, gatedPages: { label: string; gate: Gate }[]): Finding[] {
  const fromSetting = setting.ok && setting.data.comingSoon;
  if (!fromSetting && gatedPages.length === 0) return [];
  const maintenance = !fromSetting && gatedPages.every((p) => p.gate.kind === "maintenance");
  const scope = setting.ok && setting.data.comingSoon ? (setting.data.storePagesOnly ? "store pages only" : "the whole site") : null;
  const evidence = [
    fromSetting ? `WooCommerce site visibility is set to Coming soon (${scope}).` : null,
    ...gatedPages.map((p) => `On the ${p.label}, ${p.gate.reason}.`),
  ].filter(Boolean).join(" ");
  return [{
    finding_key: "page:store_gate",
    type: maintenance ? "store_maintenance_mode" : "store_coming_soon",
    product_id: null,
    title: maintenance ? "Store is in maintenance mode" : "Store is in Coming soon mode",
    severity: "low",
    basis: "observed",
    evidence: `${evidence} Visitors and AI agents see a placeholder, so access and structured data checks on these pages are marked unavailable.`,
    guidance: maintenance
      ? "Turn off maintenance mode when the store is ready, then rescan."
      : "When the store is ready, set WooCommerce → Settings → Site visibility to Live, then rescan.",
    fix_url: `${storeUrl}/wp-admin/admin.php?page=wc-settings&tab=site-visibility`,
  }];
}

// Gate for one page: markers in the page first, then the WooCommerce setting. The reason says what the page returned.
export function resolveGate(f: PageFetch, setting: Source<ComingSoonSetting>, page: "home" | "product"): Gate | null {
  const fromPage = pageGate(f);
  if (fromPage) return fromPage;
  const fromSetting = settingGate(setting, page);
  return fromSetting ? { ...fromSetting, reason: `${fromSetting.reason} (page: ${describePage(f)})` } : null;
}
