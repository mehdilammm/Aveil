"use server";

import { promises as dns } from "node:dns";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkManual, isToken, MANUAL_METHODS, newVerificationToken, type ManualMethod } from "@/lib/ownership";
import { recordVerification } from "@/lib/ownership-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { fetchPublicPage } from "@/lib/woo";
import { canEdit, storeAccess } from "@/lib/workspace";

export type OwnershipState = { error?: string; result?: { verified: boolean; evidence: string } };

const CHECKER_UA = "AgentScope/0.3 (+ownership check)";

// Shows a token for a method (kept until verified), or checks it now. Owners and admins only.
export async function ownershipAction(_: OwnershipState, form: FormData): Promise<OwnershipState> {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const store = await storeAccess(supabase, user.id, String(form.get("store_id") ?? ""));
  if (!store) return { error: "Store not found." };
  if (!canEdit(store.role)) return { error: "Viewers cannot verify ownership." };
  const method = String(form.get("method") ?? "") as ManualMethod;
  if (!MANUAL_METHODS.includes(method)) return { error: "Unknown method." };
  const admin = createAdminClient();
  const { data: row } = await admin.from("store_verifications").select("token").eq("store_id", store.id).eq("method", method).maybeSingle();

  if (form.get("intent") === "start" || !row?.token || !isToken(row.token)) {
    const token = row?.token && isToken(row.token) ? row.token : newVerificationToken();
    const { error } = await admin.from("store_verifications").upsert({ store_id: store.id, owner_id: store.owner_id, method, token }, { onConflict: "store_id,method" });
    if (error) return { error: "Could not save the token. Please try again." };
    revalidatePath(`/stores/${store.id}`);
    return {};
  }

  const result = await checkManual(store.url, method, row.token, {
    resolveTxt: (host) => dns.resolveTxt(host),
    fetchPage: async (url) => {
      const r = await fetchPublicPage(url, CHECKER_UA);
      return r.ok ? { ok: true, status: r.status, body: r.body, redirectedTo: r.redirectedTo } : { ok: false, error: r.error };
    },
  });
  await recordVerification(admin, store, method, result, row.token);
  revalidatePath(`/stores/${store.id}`);
  return { result };
}
