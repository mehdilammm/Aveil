import "server-only";
import { JobYield, PermanentJobError, type JobHandler } from "./jobs";
import { planOf, syncOrders } from "./orders-sync";
import { PLANS } from "./plans";
import { scanJob, type ScanTrigger } from "./scan";
import { runVisibility } from "./visibility-run";
import { purgeOldHits, refreshIpRanges, verifyStoreHits } from "./bot-jobs";
import { breakageCheck, productCheck } from "./store-checks";
import { verifyFindingJob } from "./verify-jobs";
import { NotVerifiedError, runAgentSim } from "./agent-sim-run";
import { refreshMarketFindings } from "./market-fixes-run";
import { marketOf } from "./markets";
import { enqueueFeedRefresh, refreshFeed } from "./feed-jobs";

const VISIBILITY_MIN_MS = 150_000; // a run needs a fresh tick; it stops asking at its own time budget

// Job kinds. orders_sync: reads the last 90 days of orders of one store (Pro and Agency).
// scan: the full store scan, step by step. visibility: one AI Visibility run (all questions, both engines).
// bot_ranges_refresh: reads the operators' IP lists (daily). bot_hits_verify: checks a store's new bot hits.
// bot_hits_purge: deletes hits past each store's retention (daily). verify_finding: re-checks one fixed finding.
// breakage_check: mini-scan after a plugin / theme / core change (F2). product_check: one product just published
// or updated (F3). agent_sim: the agent purchase test through the Store API, never placing an order (F7); one
// attempt only, so a cart is never filled twice. agent_sim_browser: the same test in a real headless browser (F7
// Mode B, Pro): it waits (yields) when it lands on a function without the browser files. feed_refresh: the product
// feed built again and sent to the plugin (G1), after a product change and every day.
export const JOB_HANDLERS: Record<string, JobHandler> = {
  orders_sync: async ({ admin, job, step }) => {
    if (!job.store_id) throw new Error("orders_sync needs a store");
    const { data: store } = await admin.from("stores").select("id, owner_id, url").eq("id", job.store_id).maybeSingle();
    if (!store) throw new Error("store not found");
    if (!PLANS[await planOf(admin, store.id)].aiRevenue) return;
    await step("orders", async () => {
      const { data: creds } = await admin.rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: store.owner_id }).maybeSingle<{ consumer_key: string; consumer_secret: string }>();
      if (!creds) throw new Error("No API key saved for this store.");
      return syncOrders(admin, store, { consumerKey: creds.consumer_key, consumerSecret: creds.consumer_secret });
    });
  },
  scan: async (ctx) => {
    const { admin, job } = ctx;
    if (!job.store_id) throw new PermanentJobError("scan needs a store");
    const { data: store } = await admin.from("stores").select("id, owner_id, url").eq("id", job.store_id).maybeSingle();
    if (!store) throw new PermanentJobError("store not found");
    await scanJob(ctx, store, (job.progress?.trigger as ScanTrigger) === "scheduled" ? "scheduled" : "manual");
  },
  verify_finding: verifyFindingJob,
  breakage_check: async ({ admin, job, step }) => {
    if (!job.store_id) throw new PermanentJobError("breakage_check needs a store");
    const { data: store } = await admin.from("stores").select("id, owner_id, url, workspace_id").eq("id", job.store_id).maybeSingle();
    if (!store) throw new PermanentJobError("store not found");
    if (!PLANS[await planOf(admin, store.id)].breakageAlerts) return;
    const ids = Array.isArray(job.progress?.event_ids) ? (job.progress.event_ids as string[]) : [];
    await step("check", () => breakageCheck(admin, store, job.id, ids));
  },
  product_check: async ({ admin, job, step }) => {
    if (!job.store_id) throw new PermanentJobError("product_check needs a store");
    const { data: store } = await admin.from("stores").select("id, owner_id, url, workspace_id").eq("id", job.store_id).maybeSingle();
    if (!store) throw new PermanentJobError("store not found");
    const productId = Number(job.progress?.product_id);
    if (!Number.isInteger(productId) || productId <= 0) throw new PermanentJobError("product_check needs a product");
    const ids = Array.isArray(job.progress?.event_ids) ? (job.progress.event_ids as string[]) : [];
    await step("check", () => productCheck(admin, store, productId, job.id, ids));
    // G1: a product changed, so the served feed is rebuilt (one refresh for updates close together).
    await step("feed", () => enqueueFeedRefresh(admin, store, 120));
  },
  feed_refresh: async ({ admin, job, step }) => {
    if (!job.store_id) throw new PermanentJobError("feed_refresh needs a store");
    const { data: store } = await admin.from("stores").select("id, owner_id, url, workspace_id").eq("id", job.store_id).maybeSingle();
    if (!store) throw new PermanentJobError("store not found");
    await step("refresh", () => refreshFeed(admin, store));
  },
  agent_sim: async ({ admin, job, step }) => {
    if (!job.store_id) throw new PermanentJobError("agent_sim needs a store");
    const { data: store } = await admin.from("stores").select("id, url, owner_id").eq("id", job.store_id).maybeSingle();
    if (!store) throw new PermanentJobError("store not found");
    const market = marketOf(job.progress?.market);
    if (!market) throw new PermanentJobError("agent_sim needs a market");
    await step("simulate", async () => {
      try {
        return await runAgentSim(admin, store, market.id);
      } catch (err) {
        if (err instanceof NotVerifiedError) throw new PermanentJobError(err.message);
        throw err;
      }
    });
    // The market blockers in Fix Center again, with this test as the last one (same items, updated).
    await step("markets", async () => {
      const { data: c } = await admin.rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: store.owner_id }).maybeSingle<{ consumer_key: string; consumer_secret: string }>();
      if (!c) return { skipped: "no key" };
      return refreshMarketFindings(admin, store, { consumerKey: c.consumer_key, consumerSecret: c.consumer_secret });
    });
  },
  agent_sim_browser: async ({ admin, job, step, timeLeft }) => {
    if (!job.store_id) throw new PermanentJobError("agent_sim_browser needs a store");
    const { data: store } = await admin.from("stores").select("id, url").eq("id", job.store_id).maybeSingle();
    if (!store) throw new PermanentJobError("store not found");
    if (!PLANS[await planOf(admin, store.id)].browserTests) throw new PermanentJobError("Unavailable: needs Pro plan.");
    await step("browser", async () => {
      if (timeLeft() < 80_000) throw new JobYield(); // 60 s for the test, plus starting and saving
      const { BrowserUnavailableError, runBrowserTest } = await import("./browser-sim-run");
      try {
        return await runBrowserTest(admin, store, job.id);
      } catch (err) {
        if (err instanceof NotVerifiedError) throw new PermanentJobError(err.message);
        if (err instanceof BrowserUnavailableError) {
          const yields = Number(job.progress?.yields ?? 0) + 1;
          if (yields > 5) throw new PermanentJobError("The browser is not available in this deployment.");
          await admin.from("jobs").update({ progress: { ...job.progress, yields } }).eq("id", job.id);
          throw new JobYield();
        }
        throw err;
      }
    });
  },
  bot_ranges_refresh: async ({ admin, step }) => {
    await step("lists", () => refreshIpRanges(admin));
  },
  bot_hits_verify: async (ctx) => {
    if (!ctx.job.store_id) throw new PermanentJobError("bot_hits_verify needs a store");
    await verifyStoreHits(ctx, ctx.job.store_id);
  },
  bot_hits_purge: async ({ admin, step }) => {
    await step("purge", () => purgeOldHits(admin));
  },
  visibility: async ({ admin, job, step, timeLeft }) => {
    if (!job.store_id) throw new PermanentJobError("visibility needs a store");
    const { data: store } = await admin.from("stores").select("id, owner_id, name, url").eq("id", job.store_id).maybeSingle();
    if (!store) throw new PermanentJobError("store not found");
    const r = await step("run", async () => {
      if (timeLeft() < VISIBILITY_MIN_MS) throw new JobYield();
      return runVisibility(admin, store, { test: job.progress?.test === true, recheck: typeof job.progress?.recheck_day === "number", budgetMs: timeLeft() - 20_000 });
    });
    await admin.from("jobs").update({ progress: { ...job.progress, run_id: r.runId ?? null, step: "done" } }).eq("id", job.id);
    // A refusal (weekly limit, daily cap, no questions) is the job's result, not something to retry.
    if (r.error && !r.runId) throw new PermanentJobError(r.error);
  },
};
