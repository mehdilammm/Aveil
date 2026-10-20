"use server";

import { redirect } from "next/navigation";
import { encrypt } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { normalizeStoreUrl } from "@/lib/url";

export type AddStoreState = { error?: string };

const KEY_RE = /^ck_[A-Za-z0-9]{20,64}$/;
const SECRET_RE = /^cs_[A-Za-z0-9]{20,64}$/;

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
  if (error || !store) return { error: "Could not save the store." };

  const admin = createAdminClient();
  const { error: credErr } = await admin.from("store_credentials").insert({
    store_id: store.id,
    owner_id: user.id,
    consumer_key_enc: encrypt(consumerKey, store.id),
    consumer_secret_enc: encrypt(consumerSecret, store.id),
    key_hint: `ck_…${consumerKey.slice(-4)}`,
  });
  if (credErr) {
    await supabase.from("stores").delete().eq("id", store.id);
    return { error: "Could not save the API key." };
  }
  redirect(`/stores/${store.id}`);
}
