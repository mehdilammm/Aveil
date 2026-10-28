import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BROWSER_UA, AI_BOTS } from "./access";
import { runStructuredChecks } from "./agent-checks";
import { altFindings, altProductOf } from "./alt-text";
import { imageUse } from "./alt-text-run";
import { applyFixes, fixContext, planAuto } from "./autofix";
import { breakageAlert, newProblems, type Change } from "./breakage";
import { checkCheckout } from "./checkout";
import { checkFeedProduct } from "./feed";
import { checkStoreGate } from "./gate";
import { planOf } from "./orders-sync";
import { wooCommerceAdapter } from "./platform/woocommerce";
import { PLANS } from "./plans";
import { checkProduct, type Finding, type WooProduct } from "./rules";
import { pageUrlOf } from "./sampling";
import { politePage, schemaPage, slim } from "./scan";
import { autoRollback, selfHeal } from "./self-heal-run";
import { checkStructuredData } from "./structured-data";
import { fetchProductsFor, fetchPublishedProduct, type WooCredentials } from "./woo";

type Store = { id: string; owner_id: string; url: string; workspace_id: string };
const MINI_PRODUCTS = 3;

async function setup(admin: SupabaseClient, store: Store) {
  const { data: c } = await admin.rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: store.owner_id }).maybeSingle<{ consumer_key: string; consumer_secret: string }>();
  if (!c) throw new Error("No API key is saved for this store.");
  const creds: WooCredentials = { consumerKey: c.consumer_key, consumerSecret: c.consumer_secret };
  const { data: connector } = await admin.rpc("get_traffic_connector_secret", { p_store_id: store.id }).maybeSingle<{ token: string }>();
  return { creds, adapter: wooCommerceAdapter(store.url, creds), checkToken: connector?.token ?? null };
}

async function lastScan(admin: SupabaseClient, storeId: string) {
  const { data } = await admin.from("scans").select("id").eq("store_id", storeId).eq("status", "complete").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

// F2 mini-scan: bot access and structured data on 3 product pages of the last scan's sample, robots.txt, the
// store gate and the checkout page (browser and GPTBot). About 15 requests. Nothing is saved as a scan.
export async function miniScan(admin: SupabaseClient, store: Store): Promise<{ findings: Finding[]; scanId: string | null; pages: string[] }> {
  const { creds, adapter, checkToken } = await setup(admin, store);
  const scanId = await lastScan(admin, store.id);
  const { data: sample } = scanId ? await admin.from("scan_schema_pages").select("product_id, url").eq("scan_id", scanId).order("product_id").limit(MINI_PRODUCTS) : { data: [] };
  let products: WooProduct[] = [];
  if (sample?.length) products = await fetchProductsFor(store.url, creds, { ids: sample.map((s) => Number(s.product_id)) });
  else products = (await adapter.fetchProductsPage(1)).items.slice(0, MINI_PRODUCTS) as WooProduct[];
  const picked = products.flatMap((p) => {
    const url = pageUrlOf(store.url, p);
    return url ? [{ url, product: p }] : [];
  }).slice(0, MINI_PRODUCTS);

  const { settings, pages, comingSoon } = await adapter.fetchPolicies();
  const access = await adapter.checkBotAccess(picked.map((p) => p.url), comingSoon, checkToken);
  const currency = settings.ok && /^[A-Z]{3}$/.test(settings.data.woocommerce_currency ?? "") ? settings.data.woocommerce_currency : null;
  const findings: Finding[] = [...access.findings, ...checkStoreGate(store.url, comingSoon, access.gated), ...(await runStructuredChecks(store.url, picked, access.pages, currency, checkToken))];

  const { zones, gateways } = await adapter.fetchCheckoutSetup();
  const checkoutId = settings.ok ? Number(settings.data.woocommerce_checkout_page_id ?? 0) : 0;
  const slug = pages.ok ? pages.data.find((p) => p.id === checkoutId)?.slug : undefined;
  let checkoutPage = null;
  if (slug) {
    const url = `${store.url}/${slug}/`;
    const browser = await politePage(url, BROWSER_UA, checkToken);
    const bot = await politePage(url, AI_BOTS.find((b) => b.name === "GPTBot")!.ua, checkToken);
    checkoutPage = { url, browser: browser.res, bot: bot.res, botRetried: bot.retried };
  }
  findings.push(...checkCheckout({
    storeUrl: store.url, settings, zones, gateways, checkoutPage,
    products: { total: picked.length, outOfStock: picked.filter((p) => p.product.stock_status === "outofstock").length, needShipping: picked.filter((p) => !p.product.virtual).length },
  }));
  return { findings, scanId, pages: picked.map((p) => p.url) };
}

// The breakage job: mini-scan, compare with the last full scan, raise an alert when something new broke.
export async function breakageCheck(admin: SupabaseClient, store: Store, jobId: string, eventIds: string[]) {
  const { data: events } = await admin.from("store_events").select("event_id, kind, subject, old_version, new_version, occurred_at").eq("store_id", store.id).in("event_id", eventIds);
  const startedAt = Date.now();
  const { findings, scanId } = await miniScan(admin, store);
  const { data: before } = scanId ? await admin.from("findings").select("finding_key, basis").eq("scan_id", scanId) : { data: [] };
  const problems = newProblems(findings, (before ?? []) as { finding_key: string; basis: string }[]);
  const alert = breakageAlert((events ?? []) as Change[], problems, scanId);
  if (alert) {
    await admin.from("store_alerts").insert({ store_id: store.id, owner_id: store.owner_id, kind: "breakage", title: alert.title, detail: alert.detail, event_ids: eventIds, job_id: jobId });
  }
  // G10 then G9 (Pro): undo a recent fix of ours a new problem points to; put back a fix of ours that is gone.
  const healing: Record<string, unknown> = {};
  if (PLANS[await planOf(admin, store.id)].autoFix) {
    const byKey = new Map(findings.map((f) => [f.finding_key, f]));
    healing.rollback = await autoRollback(admin, store, problems.map((p) => ({ finding_key: p.finding_key, type: p.type, title: p.title, evidence: p.evidence, product_id: byKey.get(p.finding_key)?.product_id ?? null })), jobId);
    const { data: s } = await admin.from("stores").select("auto_fix_enabled").eq("id", store.id).maybeSingle();
    if (s?.auto_fix_enabled) healing.self_heal = await selfHeal(admin, store, { keys: new Set(findings.filter((f) => f.basis !== "unavailable").map((f) => f.finding_key)), at: startedAt }, jobId);
  }
  return { checked: findings.length, new_problems: problems.length, alert: Boolean(alert), ...healing };
}

// F3 instant check: one product's data rules, feed fields and page structured data; with auto-fix on (Pro), the
// auto fixes for it are applied and verified. The result is shown as a notice (store_alerts kind product_check).
export async function productCheck(admin: SupabaseClient, store: Store, productId: number, jobId: string, eventIds: string[]) {
  const { creds, adapter, checkToken } = await setup(admin, store);
  const p = await fetchPublishedProduct(store.url, creds, productId);
  if (!p) return { skipped: "not published" };
  const variations = p.type === "variable" ? await adapter.fetchVariations(p.id) : [];
  const findings: Finding[] = [...checkProduct(p, variations), ...checkFeedProduct(p)];
  // G4: its images without alt text (images other products also show are left alone).
  const alt = altProductOf(p, variations);
  if ([...alt.images, ...alt.variations.flatMap((v) => (v.image ? [v.image] : []))].some((i) => !i.alt.trim())) findings.push(...altFindings([alt], await imageUse(store, creds)));
  const url = pageUrlOf(store.url, p);
  if (url) {
    const page = schemaPage(slim(p), url, (await adapter.fetchProductSchema(url, checkToken)).page);
    findings.push(...checkStructuredData([page], null));
  }
  const issues = findings.filter((f) => f.basis !== "unavailable");
  const plan = PLANS[await planOf(admin, store.id)];
  const { data: s } = await admin.from("stores").select("auto_fix_enabled").eq("id", store.id).maybeSingle();
  let fixed: { describe: string; verify: string | null }[] = [];
  if (plan.autoFix && s?.auto_fix_enabled && issues.length) {
    const ctx = await fixContext(admin, store);
    const ready = planAuto(ctx, issues.map((f) => ({ finding_key: f.finding_key, type: f.type, evidence: f.evidence, product_id: f.product_id, title: f.title }))).filter((x) => x.ready);
    if (ready.length) {
      const r = await applyFixes(admin, ctx, ready.map((x) => ({ finding: x.finding, type: x.type, kind: x.kind })), { userId: null, automatic: true });
      fixed = r.results.filter((x) => x.status === "applied").map((x) => ({ describe: x.describe, verify: x.verify }));
    }
  }
  const detail = {
    product: { id: p.id, name: p.name.slice(0, 200), url },
    issues: issues.slice(0, 20).map((f) => ({ finding_key: f.finding_key, title: f.title.slice(0, 200), severity: f.severity, basis: f.basis })),
    fixed,
    auto_fix: plan.autoFix ? (s?.auto_fix_enabled ? "on" : "off") : "plan",
  };
  await admin.from("store_alerts").insert({ store_id: store.id, owner_id: store.owner_id, kind: "product_check", title: `${p.name.slice(0, 200)}: ${issues.length} issues, ${fixed.length} fixed automatically`, detail, event_ids: eventIds, job_id: jobId });
  return { issues: issues.length, fixed: fixed.length };
}
