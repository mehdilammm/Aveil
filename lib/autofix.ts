import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkInput, fixFor, shipCountries, type FixKind, type FixType } from "./fix-catalog";
import { generatorInputs } from "./fixes/inputs";
import { buildLlmsTxt } from "./fixes/llms-txt";
import { patchRobots } from "./fixes/robots-patch";
import { FEED_MAX_BYTES, FEED_PATHS, FEED_SPEC, type FeedResult } from "./feed-build";
import { buildStoreFeed } from "./feed-run";
import { applySchemaFix, SCHEMA_DESCRIBE } from "./schema-fixes";
import { planOf } from "./orders-sync";
import { callPlugin } from "./plugin-client";
import { lockedReason } from "./plan-gate";
import { PLANS } from "./plans";
import { isAllowed, parseRobots } from "./robots";
import { verifyOnce } from "./verify-run";
import { fetchPublishedProduct, fetchSetting, fetchShippingZones, fetchSiteName, findBrands, wooWrite, WooError, type WooCredentials } from "./woo";

type Store = { id: string; owner_id: string; url: string; workspace_id?: string };
type Finding = { finding_key: string; type: string; evidence: string; product_id: number | null; title?: string };
export type FixContext = { store: Store; read: WooCredentials; write: WooCredentials | null; pluginToken: string | null };
export type Change = { channel: "plugin" | "write_key"; target: string; before: unknown; after: unknown; describe: string };
export type PlannedFix = { finding: Finding; type: FixType; kind: FixKind; ready: boolean; reason: string | null; describe: string };

export async function fixContext(admin: SupabaseClient, store: Store): Promise<FixContext> {
  const [{ data: read }, { data: write }, { data: connector }] = await Promise.all([
    admin.rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: store.owner_id }).maybeSingle<{ consumer_key: string; consumer_secret: string }>(),
    admin.rpc("get_store_write_credentials", { p_store_id: store.id, p_owner_id: store.owner_id }).maybeSingle<{ consumer_key: string; consumer_secret: string }>(),
    admin.rpc("get_traffic_connector_secret", { p_store_id: store.id }).maybeSingle<{ token: string }>(),
  ]);
  if (!read) throw new WooError("No API key is saved for this store.");
  return {
    store,
    read: { consumerKey: read.consumer_key, consumerSecret: read.consumer_secret },
    write: write ? { consumerKey: write.consumer_key, consumerSecret: write.consumer_secret } : null,
    pluginToken: connector?.token ?? null,
  };
}

const NEED_PLUGIN = "Needs the AgentScope Core plugin 1.6.0 or later, connected to the app.";
const NEED_PLUGIN_18 = "Needs the AgentScope Core plugin 1.8.0 or later, connected to the app.";
const NEED_WRITE = "Needs a separate write key (WooCommerce → Settings → Advanced → REST API, permission Read/Write), added in the app.";

// What the auto fixes would change now, without changing anything (the preview the merchant approves).
export function planAuto(ctx: FixContext, findings: Finding[]): PlannedFix[] {
  const out: PlannedFix[] = [];
  for (const f of findings) {
    const spec = fixFor(f);
    if (spec.type !== "auto") continue;
    if (spec.kind === "llms_txt" || spec.kind === "robots") {
      out.push({ finding: f, ...spec, ready: Boolean(ctx.pluginToken), reason: ctx.pluginToken ? null : NEED_PLUGIN, describe: spec.kind === "llms_txt" ? "Serve /llms.txt, written from your store's title, pages, categories and products." : "Allow the AI search and shopping agents in robots.txt (training crawlers keep your current setting)." });
    } else if (spec.kind === "feed") {
      out.push({ finding: f, ...spec, ready: Boolean(ctx.pluginToken), reason: ctx.pluginToken ? null : NEED_PLUGIN_18, describe: `Serve a product feed for AI shopping agents at ${FEED_PATHS.jsonl} (${FEED_SPEC.name} ${FEED_SPEC.version}) and ${FEED_PATHS.csv}, from your published products; refreshed when a product changes and every day.` });
    } else if (spec.kind === "org" || spec.kind === "website" || spec.kind === "breadcrumbs" || spec.kind === "shipping" || spec.kind === "variants") {
      out.push({ finding: f, ...spec, ready: Boolean(ctx.pluginToken), reason: ctx.pluginToken ? null : NEED_PLUGIN_18, describe: SCHEMA_DESCRIBE[spec.kind] });
    } else if (spec.kind === "brand") {
      out.push({ finding: f, ...spec, ready: Boolean(ctx.write || ctx.pluginToken), reason: ctx.write || ctx.pluginToken ? null : NEED_WRITE, describe: ctx.write ? `Set the product's brand to your store's name (#${f.product_id}).` : `Add your store's name as the brand in the product's structured data (#${f.product_id}).` });
    }
  }
  return out;
}

// The block of AgentScope groups the plugin appends to the virtual robots.txt.
function robotsBlock(text: string, productPath: string | null): string {
  const training = isAllowed(parseRobots(text), "GPTBot", "/") ? "allow" : "block";
  const patched = patchRobots(text, training, productPath).text;
  const at = patched.indexOf("# AgentScope");
  return at >= 0 ? patched.slice(at) : "";
}

// Computes and applies one fix; returns the change for the audit log. Throws with the reason when it cannot.
async function applyChange(admin: SupabaseClient, ctx: FixContext, f: Finding, kind: FixKind, value: string | null, fixId: string): Promise<Change> {
  const { store } = ctx;
  if (kind === "llms_txt" || kind === "robots") {
    if (!ctx.pluginToken) throw new Error(NEED_PLUGIN);
    const inputs = await generatorInputs(admin, store, ctx.read);
    const status = await callPlugin(store.url, ctx.pluginToken, { action: "status" });
    if (kind === "llms_txt" && status.environment.llms_file) throw new Error("The site has an llms.txt file; replace it with the generated one (Fix generators).");
    if (kind === "robots" && status.environment.robots_file) throw new Error("The site has a robots.txt file, so WordPress does not build it; use the robots.txt patch (Fix generators).");
    const text = kind === "llms_txt" ? buildLlmsTxt(inputs.llms).text : robotsBlock(inputs.robots.text, inputs.productPath);
    if (!text.trim()) throw new Error("Nothing to add.");
    await callPlugin(store.url, ctx.pluginToken, { action: "apply", fixes: [{ id: fixId, kind, payload: { text } }] });
    return { channel: "plugin", target: kind === "llms_txt" ? "/llms.txt" : "/robots.txt", before: null, after: { fix_id: fixId, text }, describe: kind === "llms_txt" ? "Served /llms.txt" : "Added the AI agent groups to robots.txt" };
  }

  if (kind === "feed") {
    if (!ctx.pluginToken) throw new Error(NEED_PLUGIN_18);
    if (!PLANS[await planOf(admin, store.id)].productFeed) throw new Error(lockedReason("productFeed"));
    const feed = await buildStoreFeed(store, ctx.read);
    return pushFeed(ctx, fixId, feed);
  }

  if (kind === "org" || kind === "website" || kind === "breadcrumbs" || kind === "shipping" || kind === "variants") return applySchemaFix(ctx, kind, fixId);

  const pid = f.product_id;
  if (kind === "brand") {
    const site = await fetchSiteName(store.url);
    const name = site.ok ? site.data.trim() : "";
    if (!name) throw new Error("The store has no site title to use as the brand.");
    if (ctx.write && pid) {
      const product = await fetchPublishedProduct(store.url, ctx.read, pid);
      if (!product) throw new Error(`Product #${pid} is not published.`);
      // Reuse the brand if it exists, else create it (one term named like the store).
      let all = await findBrands(store.url, ctx.read, name);
      if (!all.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
        await wooWrite(store.url, "POST", "/products/brands", { name }, ctx.write);
        all = await findBrands(store.url, ctx.read, name);
      }
      const brand = all.find((b) => b.name.toLowerCase() === name.toLowerCase());
      if (!brand) throw new Error("The brand could not be created in WooCommerce.");
      await wooWrite(store.url, "PUT", `/products/${pid}`, { brands: [{ id: brand.id }] }, ctx.write);
      return { channel: "write_key", target: `product:${pid}`, before: { brands: product.brands ?? [] }, after: { brands: [{ id: brand.id, name: brand.name }] }, describe: `Brand "${brand.name}" set on product #${pid}` };
    }
    if (!ctx.pluginToken || !pid) throw new Error(NEED_WRITE);
    await callPlugin(store.url, ctx.pluginToken, { action: "apply", fixes: [{ id: fixId, kind: "jsonld", target: pid, payload: { brand_fallback: name } }] });
    return { channel: "plugin", target: `product:${pid}`, before: null, after: { fix_id: fixId, brand_fallback: name }, describe: `Brand "${name}" added to the structured data of product #${pid}` };
  }

  if (!ctx.write) throw new Error(NEED_WRITE);
  if (kind === "sell_where_ship") {
    const zones = await fetchShippingZones(store.url, ctx.read);
    if (!zones.ok) throw new Error(zones.reason);
    const countries = shipCountries(zones.data);
    if (!countries) throw new Error("A shipping zone covers a continent or postcodes; choose the selling countries in WooCommerce.");
    const before = { woocommerce_allowed_countries: await fetchSetting(store.url, "general", "woocommerce_allowed_countries", ctx.read), woocommerce_specific_allowed_countries: await fetchSetting(store.url, "general", "woocommerce_specific_allowed_countries", ctx.read) };
    await wooWrite(store.url, "PUT", "/settings/general/woocommerce_specific_allowed_countries", { value: countries }, ctx.write);
    await wooWrite(store.url, "PUT", "/settings/general/woocommerce_allowed_countries", { value: "specific" }, ctx.write);
    return { channel: "write_key", target: "settings:general", before, after: { woocommerce_allowed_countries: "specific", woocommerce_specific_allowed_countries: countries }, describe: `Selling locations set to where you ship: ${countries.join(", ")}` };
  }
  if (kind === "guest_checkout") {
    const before = { woocommerce_enable_guest_checkout: await fetchSetting(store.url, "account", "woocommerce_enable_guest_checkout", ctx.read) };
    await wooWrite(store.url, "PUT", "/settings/account/woocommerce_enable_guest_checkout", { value: "yes" }, ctx.write);
    return { channel: "write_key", target: "settings:account", before, after: { woocommerce_enable_guest_checkout: "yes" }, describe: "Guest checkout turned on" };
  }

  // Input fixes: the merchant's value, checked, written to the product.
  if (!pid) throw new Error("This fix needs a product.");
  const field = kind as "price" | "image" | "weight" | "gtin";
  const checked = checkInput(field, value ?? "");
  if (!checked.ok) throw new Error(checked.reason);
  const product = await fetchPublishedProduct(store.url, ctx.read, pid);
  if (!product) throw new Error(`Product #${pid} is not published.`);
  if (field === "price" && product.type === "variable") throw new Error("This product has variations: set the price on each variation in WooCommerce.");
  const raw = product as unknown as Record<string, unknown>;
  const patch =
    field === "price" ? { regular_price: checked.value }
    : field === "weight" ? { weight: checked.value }
    : field === "gtin" ? { global_unique_id: checked.value }
    : { images: [{ src: checked.value }, ...(product.images ?? []).map((i) => ({ id: i.id }))] };
  const before = field === "price" ? { regular_price: raw.regular_price ?? "", sale_price: raw.sale_price ?? "" } : field === "weight" ? { weight: raw.weight ?? "" } : field === "gtin" ? { global_unique_id: raw.global_unique_id ?? "" } : { images: (product.images ?? []).map((i) => ({ id: i.id })) };
  await wooWrite(store.url, "PUT", `/products/${pid}`, patch, ctx.write);
  return { channel: "write_key", target: `product:${pid}`, before, after: patch, describe: `${field === "gtin" ? "GTIN" : field[0].toUpperCase() + field.slice(1)} set on product #${pid}: ${checked.value}` };
}

// Sends a built feed to the plugin as one fix (the same id replaces the stored feed on a refresh).
export async function pushFeed(ctx: FixContext, fixId: string, feed: FeedResult): Promise<Change> {
  if (!ctx.pluginToken) throw new Error(NEED_PLUGIN_18);
  if (!feed.counts.products) throw new Error(`No product can be listed in the feed: ${feed.rows.map((r) => `#${r.id} ${r.jsonReason ?? "?"}`).slice(0, 5).join("; ") || "the store has no published product"}.`);
  if (feed.bytes > FEED_MAX_BYTES) throw new Error(`The feed is ${(feed.bytes / 1048576).toFixed(1)} MB; this version sends at most ${FEED_MAX_BYTES / 1048576} MB to the plugin.`);
  const answer = await callPlugin(ctx.store.url, ctx.pluginToken, { action: "apply", fixes: [{ id: fixId, kind: "feed", payload: { metadata: JSON.stringify(feed.metadata), jsonl: feed.jsonl, csv: feed.csv } }] });
  if (!answer.done.some((d) => d.id === fixId)) throw new Error(`The plugin did not take the feed (plugin ${answer.plugin_version}; the feed needs 1.8.0 or later).`);
  return {
    channel: "plugin",
    target: FEED_PATHS.jsonl,
    before: null,
    after: { fix_id: fixId, spec: `${FEED_SPEC.name} ${FEED_SPEC.version}`, updated_at: feed.metadata.updated_at, counts: feed.counts, bytes: feed.bytes },
    describe: `Product feed served: ${feed.counts.products} products, ${feed.counts.variants} variants (${feed.counts.excluded} left out); CSV ${feed.counts.csvRows} rows`,
  };
}

export type AppliedFix = { auditId: string; finding_key: string; status: "applied" | "failed"; describe: string; error: string | null; verify: string | null };

// Applies fixes, records each in the audit log, then re-checks each finding (cache bypassed).
export async function applyFixes(
  admin: SupabaseClient,
  ctx: FixContext,
  items: { finding: Finding; type: FixType; kind: FixKind; value?: string | null }[],
  by: { userId: string | null; automatic: boolean },
): Promise<{ batchId: string; results: AppliedFix[] }> {
  const batchId = randomUUID();
  const results: AppliedFix[] = [];
  for (const it of items) {
    const fixId = randomUUID();
    let change: Change | null = null;
    let error: string | null = null;
    try {
      change = await applyChange(admin, ctx, it.finding, it.kind, it.value ?? null, fixId);
    } catch (err) {
      error = (err instanceof Error ? err.message : "The fix could not be applied.").slice(0, 500);
    }
    let verify: Awaited<ReturnType<typeof verifyOnce>> | null = null;
    if (change) {
      verify = await verifyOnce(admin, ctx.store, ctx.read, { finding_key: it.finding.finding_key, type: it.finding.type, product_id: it.finding.product_id }, fixId.slice(0, 12)).catch(() => null);
    }
    const { data: row } = await admin.from("fix_audit_log").insert({
      id: fixId, store_id: ctx.store.id, owner_id: ctx.store.owner_id, batch_id: batchId, finding_key: it.finding.finding_key, fix_type: it.type, kind: it.kind,
      channel: change?.channel ?? (["llms_txt", "robots", "feed", "org", "website", "breadcrumbs", "shipping", "variants", "returns"].includes(it.kind) ? "plugin" : "write_key"), target: change?.target ?? (it.finding.product_id ? `product:${it.finding.product_id}` : it.kind),
      before: change?.before ?? null, after: change ? { ...(change.after as object), describe: change.describe } : null, status: change ? "applied" : "failed", error,
      verify_status: verify?.status ?? null, verify_evidence: verify?.evidence?.slice(0, 1000) ?? null, applied_by: by.userId, automatic: by.automatic,
    }).select("id").single();
    if (change && verify) {
      const { data: scan } = await admin.from("scans").select("id").eq("store_id", ctx.store.id).eq("status", "complete").order("created_at", { ascending: false }).limit(1).maybeSingle();
      await admin.from("finding_verifications").upsert({ store_id: ctx.store.id, owner_id: ctx.store.owner_id, finding_key: it.finding.finding_key, scan_id: scan?.id ?? null, status: verify.status, evidence: verify.evidence.slice(0, 1000), attempts: 1, requested_by: by.userId, checked_at: new Date().toISOString() }, { onConflict: "store_id,finding_key" });
    }
    results.push({ auditId: row?.id ?? fixId, finding_key: it.finding.finding_key, status: change ? "applied" : "failed", describe: change?.describe ?? it.kind, error, verify: verify?.status ?? null });
  }
  return { batchId, results };
}

// Undo: puts back the "before" values (write key) or removes the plugin fix. One click per row or per batch.
export async function revertFix(admin: SupabaseClient, ctx: FixContext, auditId: string, userId: string | null): Promise<{ ok: boolean; error?: string }> {
  const { data: row } = await admin.from("fix_audit_log").select("*").eq("id", auditId).eq("store_id", ctx.store.id).maybeSingle();
  if (!row || row.status !== "applied") return { ok: false, error: "Nothing to undo." };
  try {
    const before = (row.before ?? {}) as Record<string, unknown>;
    const after = (row.after ?? {}) as Record<string, unknown>;
    if (row.channel === "plugin") {
      if (!ctx.pluginToken) throw new Error(NEED_PLUGIN);
      await callPlugin(ctx.store.url, ctx.pluginToken, { action: "revert", ids: [String(after.fix_id ?? row.id)] });
    } else {
      if (!ctx.write) throw new Error(NEED_WRITE);
      const target = String(row.target);
      if (target.startsWith("product:")) await wooWrite(ctx.store.url, "PUT", `/products/${target.slice(8)}`, before, ctx.write);
      else {
        const group = target.split(":")[1];
        // Settings: the specific countries first, then the mode, the reverse of how they were set.
        for (const [id, value] of Object.entries(before).reverse()) await wooWrite(ctx.store.url, "PUT", `/settings/${group}/${id}`, { value: value ?? "" }, ctx.write);
      }
    }
    await admin.from("fix_audit_log").update({ status: "reverted", reverted_by: userId, reverted_at: new Date().toISOString() }).eq("id", auditId);
    await admin.from("finding_verifications").delete().eq("store_id", ctx.store.id).eq("finding_key", row.finding_key);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Undo failed." };
  }
}
