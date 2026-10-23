import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { JobYield, PermanentJobError, type StepContext } from "./jobs";
import { RECHECK_DAYS, recheckDue, type VerifyResult } from "./verify";
import { verifyOnce } from "./verify-run";

const ATTEMPTS = 3; // a fix can take a moment to reach the cache or CDN
const WAIT_MS = 20_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Job verify_finding: up to 3 re-checks 20 s apart while the finding is still there; stops at the first clear answer.
export async function verifyFindingJob(ctx: StepContext) {
  const { admin, job, step, timeLeft } = ctx;
  const key = String(job.progress?.finding_key ?? "");
  if (!job.store_id || !key) throw new PermanentJobError("verify_finding needs a store and a finding");
  const { data: store } = await admin.from("stores").select("id, owner_id, url, workspace_id").eq("id", job.store_id).maybeSingle();
  if (!store) throw new PermanentJobError("store not found");
  const { data: finding } = await admin.from("findings").select("finding_key, type, product_id").eq("scan_id", String(job.progress?.scan_id ?? "")).eq("finding_key", key).maybeSingle();
  if (!finding) throw new PermanentJobError("This finding is not in the last scan.");
  const { data: creds } = await admin.rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: store.owner_id }).maybeSingle<{ consumer_key: string; consumer_secret: string }>();
  if (!creds) throw new PermanentJobError("No API key is saved for this store.");

  let result: VerifyResult = { status: "unavailable", evidence: "Not checked." };
  let attempts = 0;
  for (let i = 1; i <= ATTEMPTS; i++) {
    result = await step(`attempt:${i}`, async () => {
      if (timeLeft() < 90_000) throw new JobYield();
      if (i > 1) await sleep(WAIT_MS);
      return verifyOnce(admin, store, { consumerKey: creds.consumer_key, consumerSecret: creds.consumer_secret }, { finding_key: key, type: finding.type, product_id: finding.product_id }, randomBytes(6).toString("hex"));
    });
    attempts = i;
    await admin.from("finding_verifications").update({ status: result.status === "still_open" && i < ATTEMPTS ? "running" : result.status, evidence: result.evidence.slice(0, 1000), attempts, checked_at: new Date().toISOString() }).eq("store_id", store.id).eq("finding_key", key);
    if (result.status !== "still_open") break;
  }
  await admin.from("jobs").update({ progress: { ...job.progress, status: result.status, evidence: result.evidence, attempts } }).eq("id", job.id);
  if (result.status === "resolved") await scheduleRechecks(admin, store, key);
}

// One visibility run per store and day, 7, 14 and 30 days after a verified fix (fixes on the same day share them).
export async function scheduleRechecks(admin: SupabaseClient, store: { id: string; owner_id: string; workspace_id: string }, findingKey: string, now = new Date()) {
  for (const day of RECHECK_DAYS) {
    const due = recheckDue(now, day);
    const dueOn = due.slice(0, 10);
    const { data: row } = await admin.from("visibility_rechecks").select("finding_keys, job_id").eq("store_id", store.id).eq("due_on", dueOn).maybeSingle();
    if (row) {
      const keys = [...new Set([...(row.finding_keys as string[]), findingKey])];
      await admin.from("visibility_rechecks").update({ finding_keys: keys }).eq("store_id", store.id).eq("due_on", dueOn);
      continue;
    }
    const { data: job } = await admin.from("jobs").insert({ workspace_id: store.workspace_id, store_id: store.id, kind: "visibility", run_after: due, progress: { recheck_day: day } }).select("id").single();
    await admin.from("visibility_rechecks").insert({ store_id: store.id, owner_id: store.owner_id, due_on: dueOn, day, finding_keys: [findingKey], job_id: job?.id ?? null });
  }
}
