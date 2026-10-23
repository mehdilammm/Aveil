"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildDescription, cleanInputs, INPUT_FIELDS } from "@/lib/fixes/description";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { fetchProductFacts } from "@/lib/woo";
import { canEdit, storeAccess } from "@/lib/workspace";

export type DraftState = { error?: string };

async function editor(storeId: string) {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const store = await storeAccess(supabase, user.id, storeId);
  return store && canEdit(store.role) ? { store, user } : null;
}

// Builds (or rebuilds) the draft for one product from its current data and the merchant's inputs.
export async function generateDraft(_: DraftState, form: FormData): Promise<DraftState> {
  const ctx = await editor(String(form.get("store_id") ?? ""));
  if (!ctx) return { error: "Only owners and admins can do this." };
  const productId = Number(form.get("product_id"));
  if (!Number.isInteger(productId) || productId <= 0) return { error: "Pick a product." };
  const admin = createAdminClient();
  const { data: creds } = await admin.rpc("get_store_credentials", { p_store_id: ctx.store.id, p_owner_id: ctx.store.owner_id }).maybeSingle<{ consumer_key: string; consumer_secret: string }>();
  if (!creds) return { error: "No API key is saved for this store." };
  const facts = await fetchProductFacts(ctx.store.url, { consumerKey: creds.consumer_key, consumerSecret: creds.consumer_secret }, productId);
  if (!facts.ok) return { error: facts.reason };
  const inputs = cleanInputs(Object.fromEntries(INPUT_FIELDS.map((k) => [k, form.get(k)])));
  const draft = buildDescription(facts.data, inputs);
  const { error } = await admin.from("description_drafts").upsert(
    {
      store_id: ctx.store.id, owner_id: ctx.store.owner_id, product_id: productId, product_name: facts.data.name.slice(0, 300),
      current_html: (facts.data.description ?? "").slice(0, 100000), proposed_html: draft.html, inputs, unknowns: draft.unknowns,
      status: "draft", created_by: ctx.user.id, approved_by: null, approved_at: null, updated_at: new Date().toISOString(),
    },
    { onConflict: "store_id,product_id" },
  );
  if (error) return { error: "Could not save the draft." };
  revalidatePath(`/stores/${ctx.store.id}/fix/descriptions`);
  return {};
}

// Approval after the side-by-side review. It does not change the store: the text is copied or exported.
export async function setDraftStatus(form: FormData) {
  const ctx = await editor(String(form.get("store_id") ?? ""));
  if (!ctx) return;
  const status = form.get("status") === "approved" ? "approved" : "discarded";
  await createAdminClient()
    .from("description_drafts")
    .update({ status, approved_by: status === "approved" ? ctx.user.id : null, approved_at: status === "approved" ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("store_id", ctx.store.id)
    .eq("id", String(form.get("draft_id") ?? ""));
  revalidatePath(`/stores/${ctx.store.id}/fix/descriptions`);
}
