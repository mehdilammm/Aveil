import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

// /check → full scan (G6): the free check's id rides in a short-lived cookie through sign-up / log-in (and the
// email confirmation link), so the add-store form opens with the checked store's URL. Only the id is kept.
export const HANDOFF_COOKIE = "agsc_from_check";
export const HANDOFF_MAX_AGE = 7 * 86_400;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isReportId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export const addStorePath = (reportId: string) => `/settings?from_check=${reportId}#add-store`;

export async function afterAuthPath(): Promise<string> {
  const id = (await cookies()).get(HANDOFF_COOKIE)?.value;
  return isReportId(id) ? addStorePath(id) : "/stores";
}

export type CheckPrefill = { reportId: string; host: string; url: string };
// Only a finished, unexpired WooCommerce check prefills the form (a Shopify store cannot be added yet).
export async function checkPrefill(admin: SupabaseClient, reportId: string | undefined, now = Date.now()): Promise<CheckPrefill | null> {
  if (!isReportId(reportId)) return null;
  const { data } = await admin.from("public_reports").select("id, host, status, report, expires_at").eq("id", reportId).maybeSingle();
  if (!data || data.status !== "complete" || Date.parse(data.expires_at) <= now) return null;
  if ((data.report as { platform?: { shopify?: boolean } } | null)?.platform?.shopify) return null;
  return { reportId: data.id, host: data.host, url: `https://${data.host}` };
}
