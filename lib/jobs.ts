import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Background jobs: each kind is a list of idempotent steps. A step that already succeeded is skipped on a retry.
// A failed job is retried with backoff (30 s × 2^attempt) up to max_attempts, then marked failed with the reason.

export type Job = { id: string; workspace_id: string | null; store_id: string | null; kind: string; attempt: number; max_attempts: number; progress: Record<string, unknown> };
export type StepContext = { admin: SupabaseClient; job: Job; step: (key: string, run: () => Promise<unknown>) => Promise<unknown> };
export type JobHandler = (ctx: StepContext) => Promise<void>;

export const LOCK_SECONDS = 240;
export const backoffSeconds = (attempt: number) => 30 * 2 ** Math.max(0, attempt - 1);

export async function runClaimedJob(admin: SupabaseClient, job: Job, handlers: Record<string, JobHandler>): Promise<"succeeded" | "retry" | "failed"> {
  const handler = handlers[job.kind];
  const finish = (fields: Record<string, unknown>) => admin.from("jobs").update({ ...fields, locked_until: null, updated_at: new Date().toISOString() }).eq("id", job.id);
  if (!handler) {
    await finish({ status: "failed", error: `No handler for job kind "${job.kind}".` });
    return "failed";
  }
  const { data: done } = await admin.from("job_steps").select("step_key").eq("job_id", job.id).eq("status", "succeeded");
  const finished = new Set((done ?? []).map((d) => d.step_key));
  const step = async (key: string, run: () => Promise<unknown>) => {
    if (finished.has(key)) return null;
    const result = await run();
    await admin.from("job_steps").upsert({ job_id: job.id, step_key: key, status: "succeeded", attempt: job.attempt, result: (result ?? null) as never, updated_at: new Date().toISOString() });
    finished.add(key);
    return result;
  };
  try {
    await handler({ admin, job, step });
    await finish({ status: "succeeded", error: null });
    return "succeeded";
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : "unknown error";
    if (job.attempt >= job.max_attempts) {
      await finish({ status: "failed", error: message });
      return "failed";
    }
    await finish({ status: "queued", error: message, run_after: new Date(Date.now() + backoffSeconds(job.attempt) * 1000).toISOString() });
    return "retry";
  }
}

// Runs claimed jobs until the time budget is used. Returns how many ran (0 = nothing to do).
export async function tick(admin: SupabaseClient, handlers: Record<string, JobHandler>, budgetMs = 200_000): Promise<{ ran: number; results: string[] }> {
  const started = Date.now();
  const results: string[] = [];
  while (Date.now() - started < budgetMs) {
    const { data, error } = await admin.rpc("claim_job", { p_seconds: LOCK_SECONDS });
    if (error) throw error;
    const job = (Array.isArray(data) ? data[0] : data) as Job | undefined;
    if (!job) break;
    results.push(`${job.kind}:${await runClaimedJob(admin, job, handlers)}`);
  }
  return { ran: results.length, results };
}
