"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type JobView = { status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; attempt: number; max_attempts: number; progress: Record<string, unknown>; error: string | null };

const POLL_MS = 3000;

// Follows a background job until it ends, then refreshes the page's server data once.
export function useJob(jobId: string | null) {
  const router = useRouter();
  const [job, setJob] = useState<JobView | null>(null);
  const done = useRef(false);
  useEffect(() => {
    if (!jobId) return;
    done.current = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (res.ok) {
          const j = (await res.json()) as JobView;
          setJob(j);
          if (j.status === "succeeded" || j.status === "failed" || j.status === "cancelled") {
            if (!done.current) router.refresh();
            done.current = true;
            return;
          }
        }
      } catch {
        // network blip: try again
      }
      timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => clearTimeout(timer);
  }, [jobId, router]);
  return job;
}
