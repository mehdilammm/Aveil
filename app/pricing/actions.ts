"use server";

import { headers } from "next/headers";
import { isPaidPlan } from "@/lib/plans";
import { clientIp, hashIp, withinRateLimit } from "@/lib/public-scan";
import { createAdminClient } from "@/lib/supabase/admin";

export type WaitlistState = { error?: string; done?: boolean };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Waitlist for paid plans until payments exist. Written by the server only (the table has no policies).
export async function joinWaitlist(_: WaitlistState, form: FormData): Promise<WaitlistState> {
  if (String(form.get("website") ?? "")) return { done: true }; // honeypot: bots fill every field
  const plan = String(form.get("plan") ?? "");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!isPaidPlan(plan)) return { error: "Unknown plan." };
  if (!EMAIL_RE.test(email) || email.length > 254) return { error: "Enter a valid email." };
  const admin = createAdminClient();
  // Same per-IP hourly limit as the public check, so the table cannot be filled by a script.
  const { data: count } = await admin.rpc("public_scan_hit", {
    p_ip_hash: hashIp(`pricing-waitlist:${clientIp(await headers())}`, process.env.IP_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "", new Date()),
    p_window_seconds: 3600,
  });
  if (!withinRateLimit(Number(count))) return { error: "Too many requests. Please try again later." };
  const { error } = await admin.from("plan_waitlist").insert({ plan, email });
  if (error && error.code !== "23505") return { error: "Could not save. Please try again." };
  return { done: true };
}
