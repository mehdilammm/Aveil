import "server-only";
import { after } from "next/server";
import { JOB_HANDLERS } from "./job-handlers";
import { tick } from "./jobs";
import { createAdminClient } from "./supabase/admin";

// Starts the queue right after the response is sent, so a job the user just asked for does not wait for the
// next minute's pg_cron tick. Runs inside the same function call (its maxDuration applies).
export function kickJobs() {
  after(async () => {
    try {
      await tick(createAdminClient(), JOB_HANDLERS);
    } catch (err) {
      console.error("job kick failed", err instanceof Error ? err.message : "unknown");
    }
  });
}
