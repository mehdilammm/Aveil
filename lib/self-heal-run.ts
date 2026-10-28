import "server-only";
import { randomUUID } from "node:crypto";
// G9 / G10: reads and writes for self-healing and auto-rollback (decisions in self-heal.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { fixContext, pushFeed, revertFix, type FixContext } from "./autofix";
import { buildStoreFeed } from "./feed-run";
import { callPlugin, type PluginFix } from "./plugin-client";
import { fixIdOf, healPlan, rollbackPlan, type AuditRow, type Rollback } from "./self-heal";
import { verifyOnce } from "./verify-run";
import { fetchPublishedProduct, fetchSetting } from "./woo";

type Store = { id: string; owner_id: string; url: string };
const AUDIT_COLUMNS = "id, finding_key, kind, channel, target, status, after, applied_at, reapplied_of";

async function auditRows(admin: SupabaseClient, storeId: string): Promise<AuditRow[]> {
  const { data } = await admin.from("fix_audit_log").select(AUDIT_COLUMNS).eq("store_id", storeId).order("applied_at", { ascending: true });
  return (data ?? []) as AuditRow[];
}

// The finding a fix answered, as the last scan recorded it (type and product, for the verify check).
async function findingOf(admin: SupabaseClient, storeId: string, key: string) {
  const { data } = await admin.from("findings").select("type, product_id").eq("store_id", storeId).eq("finding_key", key).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return { finding_key: key, type: String(data?.type ?? key.split(":")[0]), product_id: (data?.product_id as number | null) ?? null };
}

const alert = (admin: SupabaseClient, store: Store, kind: "fix_reapplied" | "fix_lost" | "fix_rolled_back", title: string, detail: Record<string, unknown>, jobId: string | null) =>
  admin.from("store_alerts").insert({ store_id: store.id, owner_id: store.owner_id, kind, title: title.slice(0, 300), detail, event_ids: [], job_id: jobId });

// The same fix again, from what the audit log recorded (the feed is built again from the products).
async function reapply(ctx: FixContext, row: AuditRow): Promise<unknown> {
  const after = row.after ?? {};
  const id = fixIdOf(row);
  if (row.kind === "feed") return (await pushFeed(ctx, id, await buildStoreFeed(ctx.store, ctx.read))).after;
  let fix: PluginFix;
  if (row.kind === "llms_txt" || row.kind === "robots") fix = { id, kind: row.kind, payload: { text: String(after.text ?? "") } };
  else if (row.kind === "brand") fix = { id, kind: "jsonld", target: Number(row.target.split(":")[1]), payload: { brand_fallback: String(after.brand_fallback ?? "") } };
  else fix = { id, kind: row.kind as PluginFix["kind"], payload: (after.payload ?? {}) as Record<string, unknown> };
  const answer = await callPlugin(ctx.store.url, ctx.pluginToken!, { action: "apply", fixes: [fix] });
  if (!answer.done.some((d) => d.id === id)) throw new Error(`The plugin (${answer.plugin_version}) did not take the fix back.`);
  return { ...after, fix_id: id };
}

// G9. back: finding keys the check that just ran found (scan or breakage mini-scan) and when it started.
export async function selfHeal(admin: SupabaseClient, store: Store, back: { keys: Set<string>; at: number }, jobId: string | null, now = Date.now()) {
  const ctx = await fixContext(admin, store);
  if (!ctx.pluginToken) return { skipped: "no plugin connection" };
  const rows = await auditRows(admin, store.id);
  if (!rows.some((r) => r.channel === "plugin" && r.status === "applied")) return { checked: 0 };
  let stored: Set<string> | null = null;
  try {
    stored = new Set((await callPlugin(store.url, ctx.pluginToken, { action: "status" })).applied.map((a) => a.id));
  } catch (err) {
    return { skipped: `plugin not reachable: ${err instanceof Error ? err.message : "unknown"}` };
  }
  const { data: lostAlerts } = await admin.from("store_alerts").select("detail").eq("store_id", store.id).eq("kind", "fix_lost");
  const alerted = new Set((lostAlerts ?? []).map((a) => String((a.detail as { audit_id?: string })?.audit_id ?? "")));
  const out: { audit_id: string; kind: string; action: string; why: string; verify?: string }[] = [];
  for (const d of healPlan(rows, stored, back, alerted, now)) {
    const what = String(d.row.after?.describe ?? d.row.kind);
    if (d.action === "wait") continue;
    if (d.action === "lost") {
      await alert(admin, store, "fix_lost", `Fix gone again: ${what}`, { audit_id: d.row.id, kind: d.row.kind, finding_key: d.row.finding_key, why: d.why, note: "It is not put back again. If you removed it on purpose, nothing to do; otherwise apply it again from Fix Center." }, jobId);
      out.push({ audit_id: d.row.id, kind: d.row.kind, action: "lost", why: d.why });
      continue;
    }
    let after: unknown = null;
    let error: string | null = null;
    try {
      after = await reapply(ctx, d.row);
    } catch (err) {
      error = (err instanceof Error ? err.message : "could not be put back").slice(0, 500);
    }
    const target = await findingOf(admin, store.id, d.row.finding_key);
    const verify = after ? await verifyOnce(admin, store, ctx.read, target, `heal${d.row.id.slice(0, 8)}`).catch(() => null) : null;
    await admin.from("fix_audit_log").insert({
      store_id: store.id, owner_id: store.owner_id, batch_id: randomUUID(), finding_key: d.row.finding_key, fix_type: "auto", kind: d.row.kind, channel: "plugin", target: d.row.target,
      before: null, after: after ? { ...(after as object), describe: `Put back: ${what}`, why: d.why } : null, status: after ? "reapplied" : "failed", error,
      verify_status: verify?.status ?? null, verify_evidence: verify?.evidence?.slice(0, 1000) ?? null, applied_by: null, automatic: true, reapplied_of: d.row.id, applied_at: new Date(now).toISOString(),
    });
    if (after && verify?.status !== "still_open") await alert(admin, store, "fix_reapplied", `Put back automatically: ${what}`, { audit_id: d.row.id, kind: d.row.kind, why: d.why, verify: verify?.status ?? "unavailable", evidence: verify?.evidence ?? null }, jobId);
    else await alert(admin, store, "fix_lost", `Fix gone and could not be put back: ${what}`, { audit_id: d.row.id, kind: d.row.kind, why: d.why, error, verify: verify?.status ?? null, evidence: verify?.evidence ?? null }, jobId);
    out.push({ audit_id: d.row.id, kind: d.row.kind, action: after ? "reapplied" : "failed", why: d.why, verify: verify?.status });
  }
  return { checked: rows.length, actions: out };
}

// Does the store still show what the fix wrote? A changed value is someone else's change and is never undone.
async function stillOurs(ctx: FixContext, row: AuditRow, stored: Set<string> | null): Promise<string | null> {
  const after = row.after ?? {};
  if (row.channel === "plugin") return stored?.has(fixIdOf(row)) ? null : "the plugin no longer has this fix";
  if (row.target.startsWith("settings:")) {
    const group = row.target.split(":")[1];
    for (const [id, value] of Object.entries(after)) {
      if (id === "describe") continue;
      const now = await fetchSetting(ctx.store.url, group, id, ctx.read);
      if (JSON.stringify(now) !== JSON.stringify(value)) return `${id} was changed since`;
    }
    return null;
  }
  if (row.kind === "brand") {
    const p = await fetchPublishedProduct(ctx.store.url, ctx.read, Number(row.target.slice(8)));
    const want = ((after.brands ?? []) as { id: number }[]).map((b) => b.id).join(",");
    return p && (p.brands ?? []).map((b) => b.id).join(",") === want ? null : "the product's brand was changed since";
  }
  return null; // alt text: the undo itself empties only the alt text that still reads what was written
}

// G10. problems: the new problems of a breakage check.
export async function autoRollback(admin: SupabaseClient, store: Store, problems: Rollback["problem"][], jobId: string | null, now = Date.now()) {
  if (!problems.length) return { rolled_back: [] };
  const plan = rollbackPlan(await auditRows(admin, store.id), problems, now);
  if (!plan.length) return { rolled_back: [] };
  const ctx = await fixContext(admin, store);
  let stored: Set<string> | null = null;
  if (ctx.pluginToken && plan.some((p) => p.row.channel === "plugin")) {
    stored = await callPlugin(store.url, ctx.pluginToken, { action: "status" }).then((a) => new Set(a.applied.map((x) => x.id))).catch(() => null);
  }
  const out: { audit_id: string; kind: string; problem: string; result: string; verify?: string }[] = [];
  for (const { row, problem } of plan) {
    const what = String(row.after?.describe ?? row.kind);
    const notOurs = await stillOurs(ctx, row, stored).catch((err) => (err instanceof Error ? err.message : "could not be read"));
    if (notOurs) {
      out.push({ audit_id: row.id, kind: row.kind, problem: problem.finding_key, result: `left: ${notOurs}` });
      continue;
    }
    const reason = `New problem after this fix (${problem.title}): ${problem.evidence}`.slice(0, 500);
    const r = await revertFix(admin, ctx, row.id, null, reason);
    const verify = r.ok ? await verifyOnce(admin, store, ctx.read, problem, `rb${row.id.slice(0, 8)}`).catch(() => null) : null;
    await alert(admin, store, "fix_rolled_back", r.ok ? `Undone automatically: ${what}` : `Could not undo: ${what}`, { audit_id: row.id, kind: row.kind, problem, reason, error: r.error ?? null, verify: verify?.status ?? null, evidence: verify?.evidence ?? null }, jobId);
    out.push({ audit_id: row.id, kind: row.kind, problem: problem.finding_key, result: r.ok ? "reverted" : `failed: ${r.error}`, verify: verify?.status });
  }
  return { rolled_back: out };
}
