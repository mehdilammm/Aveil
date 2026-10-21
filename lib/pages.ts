// Store page checks: WooCommerce shop/cart/checkout/terms pages and the policy pages.
import type { Finding, Severity } from "./rules";

export type PublicPage = { id: number; slug: string; title: string };

// "unavailable" means the API key or the site did not let us read the data.
export type Source<T> = { ok: true; data: T } | { ok: false; reason: string };

export type PageCheckInput = {
  storeUrl: string;
  // WooCommerce settings values by id, e.g. woocommerce_cart_page_id.
  settings: Source<Record<string, string>>;
  // Published pages, as anyone on the internet sees them.
  pages: Source<PublicPage[]>;
};

type AssignedPage = { key: string; label: string; setting: string; tab: string; severity: Severity; why: string };

const ASSIGNED: AssignedPage[] = [
  { key: "shop", label: "Shop", setting: "woocommerce_shop_page_id", tab: "products", severity: "medium", why: "Agents use it to browse the catalog." },
  { key: "cart", label: "Cart", setting: "woocommerce_cart_page_id", tab: "advanced", severity: "high", why: "Without it buyers cannot review an order." },
  { key: "checkout", label: "Checkout", setting: "woocommerce_checkout_page_id", tab: "advanced", severity: "high", why: "Without it nobody can buy." },
  { key: "terms", label: "Terms and conditions", setting: "woocommerce_terms_page_id", tab: "advanced", severity: "medium", why: "Agents look for terms before they recommend a purchase." },
];

type PolicyPage = { key: string; label: string; match: RegExp; words: string; severity: Severity; fixPath: string; why: string };

// WooCommerce does not expose the privacy or returns page setting to API keys, so these are found by title and address.
const POLICIES: PolicyPage[] = [
  { key: "privacy", label: "Privacy policy", match: /privacy/i, words: "privacy", severity: "medium", fixPath: "/wp-admin/options-privacy.php", why: "Buyers and agents expect to see how personal data is used." },
  { key: "returns", label: "Returns and refunds policy", match: /refund|return/i, words: "refund or return", severity: "medium", fixPath: "/wp-admin/edit.php?post_type=page", why: "Agents compare return terms before they recommend a store." },
];

function base(key: string, type: string, f: Omit<Finding, "finding_key" | "type" | "product_id">): Finding {
  return { finding_key: key, type, product_id: null, ...f };
}

function unavailable(key: string, label: string, reason: string, fixUrl: string): Finding {
  return base(`page:${key}:unavailable`, "page_check_unavailable", {
    title: `Could not check the ${label} page`,
    severity: "low",
    basis: "unavailable",
    evidence: reason,
    guidance: "Use an API key created by an administrator or shop manager, or check this page by hand.",
    fix_url: fixUrl,
  });
}

export function checkStorePages({ storeUrl, settings, pages }: PageCheckInput): Finding[] {
  const findings: Finding[] = [];
  const published = pages.ok ? new Map(pages.data.map((p) => [p.id, p])) : null;

  for (const page of ASSIGNED) {
    const settingsUrl = `${storeUrl}/wp-admin/admin.php?page=wc-settings&tab=${page.tab}`;
    if (!settings.ok) {
      findings.push(unavailable(page.key, page.label, settings.reason, settingsUrl));
      continue;
    }
    const id = Number((settings.data[page.setting] ?? "").trim());
    if (!Number.isInteger(id) || id <= 0) {
      findings.push(
        base(`page:${page.key}`, `${page.key}_page_missing`, {
          title: `${page.label} page is not set`,
          severity: page.severity,
          basis: "observed",
          evidence: `WooCommerce setting ${page.setting} is empty.`,
          guidance: `Create the page and choose it in WooCommerce → Settings. ${page.why}`,
          fix_url: settingsUrl,
        }),
      );
      continue;
    }
    if (!published) {
      findings.push(unavailable(page.key, page.label, pages.ok ? "" : pages.reason, settingsUrl));
      continue;
    }
    if (!published.has(id)) {
      findings.push(
        base(`page:${page.key}`, `${page.key}_page_unpublished`, {
          title: `${page.label} page is not published`,
          severity: page.severity,
          basis: "observed",
          evidence: `Page #${id} is set as the ${page.label} page but is not public (draft, private or deleted).`,
          guidance: `Publish page #${id}, or choose a published page in WooCommerce → Settings. ${page.why}`,
          fix_url: `${storeUrl}/wp-admin/post.php?post=${id}&action=edit`,
        }),
      );
    }
  }

  for (const policy of POLICIES) {
    const fixUrl = `${storeUrl}${policy.fixPath}`;
    if (!pages.ok) {
      findings.push(unavailable(policy.key, policy.label, pages.reason, fixUrl));
      continue;
    }
    const found = pages.data.some((p) => policy.match.test(p.slug) || policy.match.test(p.title));
    if (!found) {
      findings.push(
        base(`page:${policy.key}`, `${policy.key}_page_missing`, {
          title: `No published ${policy.label} page`,
          severity: policy.severity,
          basis: "heuristic",
          evidence: `None of the ${pages.data.length} published pages has "${policy.words}" in its title or address. Draft pages are not visible from outside.`,
          guidance: `Write and publish a ${policy.label} page and link it in the footer. ${policy.why}`,
          fix_url: fixUrl,
        }),
      );
    }
  }
  return findings;
}
