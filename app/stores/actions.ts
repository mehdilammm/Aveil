"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { hashToken } from "@/lib/traffic";
import { normalizeStoreUrl } from "@/lib/url";

export type AddStoreState = { error?: string };

const KEY_RE = /^ck_[A-Za-z0-9]{20,64}$/;
const SECRET_RE = /^cs_[A-Za-z0-9]{20,64}$/;

const SAVE_FAILED = "We could not save your API key securely, so the store was not added. Please try again in a few minutes.";

export async function addStore(_: AddStoreState, form: FormData): Promise<AddStoreState> {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");

  const name = String(form.get("name") ?? "").trim();
  const consumerKey = String(form.get("consumer_key") ?? "").trim();
  const consumerSecret = String(form.get("consumer_secret") ?? "").trim();
  const parsed = normalizeStoreUrl(String(form.get("url") ?? ""));

  if (name.length < 1 || name.length > 120) return { error: "Enter a store name (up to 120 characters)." };
  if ("error" in parsed) return { error: parsed.error };
  if (!KEY_RE.test(consumerKey)) return { error: "The consumer key should start with ck_." };
  if (!SECRET_RE.test(consumerSecret)) return { error: "The consumer secret should start with cs_." };

  // Insert as the user so RLS checks ownership.
  const { data: store, error } = await supabase.from("stores").insert({ name, url: parsed.url, owner_id: user.id }).select("id").single();
  if (error || !store) {
    console.error("add store: insert failed", error?.code, error?.message);
    return { error: "Could not save the store. Please try again." };
  }

  // Credentials go to Supabase Vault through a service-role-only function.
  let saved = false;
  try {
    const { error: credErr } = await createAdminClient().rpc("save_store_credentials", {
      p_store_id: store.id,
      p_owner_id: user.id,
      p_consumer_key: consumerKey,
      p_consumer_secret: consumerSecret,
      p_key_hint: `ck_…${consumerKey.slice(-4)}`,
    });
    if (credErr) console.error("add store: saving credentials failed", credErr.code, credErr.message);
    saved = !credErr;
  } catch (err) {
    console.error("add store: saving credentials failed", err instanceof Error ? err.message : "unknown error");
  }

  if (!saved) {
    const { error: rollbackErr } = await supabase.from("stores").delete().eq("id", store.id);
    if (rollbackErr) console.error("add store: rollback failed", store.id, rollbackErr.code);
    return { error: SAVE_FAILED };
  }
  redirect(`/stores/${store.id}`);
}

export type DeleteStoreState = { error?: string };

// Deleting the store cascades to its scans, findings and credentials; a trigger removes the Vault secrets.
export async function deleteStore(_: DeleteStoreState, form: FormData): Promise<DeleteStoreState> {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const storeId = String(form.get("store_id") ?? "");
  const confirmName = String(form.get("confirm_name") ?? "").trim();

  const { data: store } = await supabase.from("stores").select("id, name").eq("id", storeId).maybeSingle();
  if (!store) return { error: "Store not found." };
  if (confirmName !== store.name) return { error: "Type the store name exactly to confirm." };

  const { data: deleted, error } = await supabase.from("stores").delete().eq("id", store.id).select("id");
  if (error || !deleted?.length) {
    console.error("delete store failed", error?.code);
    return { error: "Could not delete the store. Please try again." };
  }
  redirect("/stores");
}

export type TrafficTokenState = { error?: string; token?: string };

// Creates (or replaces) the traffic plugin token. The token is shown once and kept encrypted in Vault.
export async function createTrafficToken(_: TrafficTokenState, form: FormData): Promise<TrafficTokenState> {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const storeId = String(form.get("store_id") ?? "");
  const { data: store } = await supabase.from("stores").select("id").eq("id", storeId).maybeSingle();
  if (!store) return { error: "Store not found." };

  const token = `agsc_${randomBytes(32).toString("base64url")}`;
  try {
    const { error } = await createAdminClient().rpc("save_traffic_connector", {
      p_store_id: store.id,
      p_owner_id: user.id,
      p_token: token,
      p_token_hash: hashToken(token),
      p_hint: `agsc_…${token.slice(-4)}`,
    });
    if (error) throw new Error(error.code ?? "rpc error");
  } catch (err) {
    console.error("create traffic token failed", err instanceof Error ? err.message : "unknown");
    return { error: "Could not create the token. Please try again." };
  }
  revalidatePath("/settings");
  return { token };
}

export async function disconnectTraffic(form: FormData): Promise<void> {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const storeId = String(form.get("store_id") ?? "");
  const { data: store } = await supabase.from("stores").select("id").eq("id", storeId).maybeSingle();
  if (!store) return;
  // Traffic data already received stays; only the connection (and its Vault secret) is removed.
  await createAdminClient().from("traffic_connectors").delete().eq("store_id", store.id).eq("owner_id", user.id);
  revalidatePath("/settings");
}
