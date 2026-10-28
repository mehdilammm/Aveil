import "server-only";
import type { FixContext, Change } from "./autofix";
import { pageUrlOf, sampleProducts } from "./sampling";
import { orgPayload, searchProbe, searchTemplate, searchWorks, shippingPayload } from "./schema-payloads";
import { callPlugin } from "./plugin-client";
import { wooCommerceAdapter } from "./platform/woocommerce";
import { fetchCountryStateNames, fetchPublicPage, fetchShippingZones } from "./woo";

export const SCHEMA_KINDS = ["org", "website", "breadcrumbs", "shipping", "variants", "returns"] as const;
export type SchemaKind = (typeof SCHEMA_KINDS)[number];
const UA = "AgentScope/0.3 (+fix)";
const NEED_18 = "Needs the AgentScope Core plugin 1.8.0 or later, connected to the app.";

export const SCHEMA_DESCRIBE: Record<Exclude<SchemaKind, "returns">, string> = {
  org: "Add an OnlineStore node to the home page's structured data: your site's name, address and logo, and only the phone, email and profile links published on your site.",
  website: "Add a WebSite node to the home page's structured data, with a search box only when your store's search answers with your products.",
  breadcrumbs: "Add a BreadcrumbList from each product's and category's real category path (only where nothing prints one).",
  shipping: "Add your WooCommerce shipping rates to the product offers where they can be written exactly (the rest is listed, not guessed).",
  variants: "Add one offer per variation (price, stock, SKU and GTIN when set) inside each variable product's AggregateOffer, on the same Product.",
};

// One signed fix to the plugin; refused when the plugin does not know the kind (older than 1.8.0).
export async function pluginSchemaFix(ctx: FixContext, fixId: string, kind: SchemaKind, payload: Record<string, unknown>) {
  if (!ctx.pluginToken) throw new Error(NEED_18);
  const answer = await callPlugin(ctx.store.url, ctx.pluginToken, { action: "apply", fixes: [{ id: fixId, kind, payload }] });
  if (!answer.done.some((d) => d.id === fixId)) throw new Error(`The plugin did not take this fix (plugin ${answer.plugin_version}; it needs 1.8.0 or later).`);
}

// G2, G3, G5, G6: reads what the part needs from the store, sends it, and returns the change for the audit log.
export async function applySchemaFix(ctx: FixContext, kind: Exclude<SchemaKind, "returns">, fixId: string): Promise<Change> {
  const { store } = ctx;
  const adapter = wooCommerceAdapter(store.url, ctx.read);
  let payload: Record<string, unknown> = {};
  let notes: string[] = [];
  if (kind === "org") {
    const { pages } = await adapter.fetchPolicies();
    const urls = [`${store.url}/`, ...(pages.ok ? pages.data.filter((p) => /contact|about/i.test(`${p.slug} ${p.title}`)).slice(0, 2).map((p) => `${store.url}/${p.slug}/`) : [])];
    const loaded = [];
    for (const url of urls) {
      const r = await fetchPublicPage(url, UA);
      if (r.ok && r.status === 200) loaded.push({ url, html: r.body });
    }
    if (!loaded.length) throw new Error("The home page could not be loaded.");
    const r = orgPayload(loaded);
    payload = r.payload;
    notes = r.evidence;
  } else if (kind === "website") {
    const first = sampleProducts(store.url, (await adapter.fetchProductsPage(1)).items, 1).items[0];
    const url = first ? pageUrlOf(store.url, first) : null;
    const term = first ? first.name.split(/\s+/).slice(0, 2).join(" ") : "";
    let works = false;
    if (url && term) {
      const r = await fetchPublicPage(searchProbe(store.url, term), UA);
      works = searchWorks(r.ok ? { status: r.status, html: r.body } : null, url);
      notes = [`search "${term}": ${r.ok ? `HTTP ${r.status}, ${works ? "lists" : "does not list"} ${url}` : r.error}`];
    }
    payload = { search: works ? searchTemplate(store.url) : "" };
  } else if (kind === "shipping") {
    const [zones, { settings }] = await Promise.all([fetchShippingZones(store.url, ctx.read), adapter.fetchPolicies()]);
    if (!zones.ok) throw new Error(zones.reason);
    const s = settings.ok ? settings.data : {};
    const countries = [...new Set(zones.data.flatMap((z) => z.locations.filter((l) => l.type === "state").map((l) => l.code.split(":")[0].toUpperCase())))];
    const stateNames: Record<string, Record<string, string>> = {};
    for (const cc of countries) stateNames[cc] = (await fetchCountryStateNames(store.url, ctx.read, cc)) ?? {};
    const r = shippingPayload({ zones: zones.data, currency: /^[A-Z]{3}$/.test(s.woocommerce_currency ?? "") ? s.woocommerce_currency : null, taxes: s.woocommerce_calc_taxes === "yes", stateNames });
    notes = r.flags;
    if (!r.payload) throw new Error(`No shipping rate can be written exactly: ${r.flags.join("; ") || "no shipping zone with a method"}.`);
    payload = r.payload;
  }
  await pluginSchemaFix(ctx, fixId, kind, payload);
  const summary =
    kind === "org" ? `Organization added${(payload as { telephone?: string }).telephone ? " with the published phone" : ""}`
    : kind === "website" ? `WebSite added${(payload as { search?: string }).search ? " with the search box" : " (no search box: the search check did not list the product)"}`
    : kind === "shipping" ? `Shipping details added for ${(payload as { zones: unknown[] }).zones.length} destination(s)${notes.length ? `; ${notes.length} not written` : ""}`
    : kind === "breadcrumbs" ? "BreadcrumbList added where none is printed"
    : "One offer per variation added";
  return { channel: "plugin", target: `jsonld:${kind}`, before: null, after: { fix_id: fixId, payload, notes }, describe: summary };
}
