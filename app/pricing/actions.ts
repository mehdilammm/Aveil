"use server";

import { isPaidPlan } from "@/lib/plans";
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
  const { error } = await createAdminClient().from("plan_waitlist").insert({ plan, email });
  if (error && error.code !== "23505") return { error: "Could not save. Please try again." };
  return { done: true };
}
