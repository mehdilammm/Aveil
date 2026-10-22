import "server-only";
import type { JobHandler } from "./jobs";
import { planOf, syncOrders } from "./orders-sync";
import { PLANS } from "./plans";

// Job kinds. orders_sync: reads the last 90 days of orders of one store (Pro and Agency).
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
};
