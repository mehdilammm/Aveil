"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { MAX_PROMPTS, suggestPrompts } from "@/lib/visibility";
import { fetchSettings, fetchTopCategories } from "@/lib/woo";

export type PromptState = { error?: string; suggestions?: string[] };

async function ownedStore(storeId: string) {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const { data: store } = await supabase.from("stores").select("id, url").eq("id", storeId).maybeSingle();
  return { supabase, user, store };
}

// Adds one or more questions (typed, or accepted suggestions). Inserted as the user, so RLS checks ownership.
export async function addPrompts(_: PromptState, form: FormData): Promise<PromptState> {
  const storeId = String(form.get("store_id") ?? "");
  const { supabase, user, store } = await ownedStore(storeId);
  if (!store) return { error: "Store not found." };

  const texts = [...form.getAll("prompt"), ...form.getAll("accept")].map((v) => String(v).replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!texts.length) return { error: "Write a question or pick a suggestion." };
  if (texts.some((t) => t.length < 3 || t.length > 300)) return { error: "Each question must be 3 to 300 characters." };

  const { count } = await supabase.from("visibility_prompts").select("id", { count: "exact", head: true }).eq("store_id", store.id);
  if ((count ?? 0) + texts.length > MAX_PROMPTS) return { error: `A store can have at most ${MAX_PROMPTS} questions.` };

  const { error } = await supabase.from("visibility_prompts").insert(texts.map((prompt) => ({ store_id: store.id, owner_id: user.id, prompt })));
  if (error) return { error: error.code === "23505" ? "That question is already in the list." : "Could not save the question." };
  revalidatePath(`/stores/${store.id}/visibility`);
  return {};
}

export async function deletePrompt(form: FormData): Promise<void> {
  const { supabase, store } = await ownedStore(String(form.get("store_id") ?? ""));
  if (!store) return;
  await supabase.from("visibility_prompts").delete().eq("id", String(form.get("prompt_id") ?? "")).eq("store_id", store.id);
  revalidatePath(`/stores/${store.id}/visibility`);
}

// Five suggestions from the store's product categories and country. Nothing is saved until the user accepts.
export async function suggest(_: PromptState, form: FormData): Promise<PromptState> {
  const { user, store } = await ownedStore(String(form.get("store_id") ?? ""));
  if (!store) return { error: "Store not found." };
  try {
    const admin = createAdminClient();
    const { data: creds } = await admin
      .rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: user.id })
      .maybeSingle<{ consumer_key: string; consumer_secret: string }>();
    if (!creds) return { error: "No API key saved for this store." };
    const woo = { consumerKey: creds.consumer_key, consumerSecret: creds.consumer_secret };
    const [categories, settings] = await Promise.all([fetchTopCategories(store.url, woo).catch(() => []), fetchSettings(store.url, ["general"], woo)]);
    const code = settings.ok ? (settings.data.woocommerce_default_country ?? "").split(":")[0] : "";
    let country: string | null = null;
    try {
      country = code ? (new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? null) : null;
    } catch {
      country = null;
    }
    return { suggestions: suggestPrompts(categories, country) };
  } catch {
    return { error: "Could not read the store's categories." };
  }
}
