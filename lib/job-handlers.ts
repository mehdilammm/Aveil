import "server-only";
import { JobYield, PermanentJobError, type JobHandler } from "./jobs";
import { planOf, syncOrders } from "./orders-sync";
import { PLANS } from "./plans";
import { scanJob, type ScanTrigger } from "./scan";
import { runVisibility } from "./visibility-run";

const VISIBILITY_MIN_MS = 150_000; // a run needs a fresh tick; it stops asking at its own time budget

// Job kinds. orders_sync: reads the last 90 days of orders of one store (Pro and Agency).
// scan: the full store scan, step by step. visibility: one AI Visibility run (all questions, both engines).
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
  visibility: async ({ admin, job, step, timeLeft }) => {
    if (!job.store_id) throw new PermanentJobError("visibility needs a store");
    const { data: store } = await admin.from("stores").select("id, owner_id, name, url").eq("id", job.store_id).maybeSingle();
    if (!store) throw new PermanentJobError("store not found");
    const r = await step("run", async () => {
      if (timeLeft() < VISIBILITY_MIN_MS) throw new JobYield();
      return runVisibility(admin, store, { test: job.progress?.test === true, budgetMs: timeLeft() - 20_000 });
    });
    await admin.from("jobs").update({ progress: { ...job.progress, run_id: r.runId ?? null, step: "done" } }).eq("id", job.id);
    // A refusal (weekly limit, daily cap, no questions) is the job's result, not something to retry.
    if (r.error && !r.runId) throw new PermanentJobError(r.error);
  },
};
