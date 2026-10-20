"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
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
