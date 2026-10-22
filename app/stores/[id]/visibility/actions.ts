"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { planOf } from "@/lib/orders-sync";
import { PLANS } from "@/lib/plans";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";
import { QUESTION_LANGUAGES, QUESTIONS_GEMINI_SCHEMA, QUESTIONS_JSON_SCHEMA, questionsPrompt, validateQuestions, type QuestionLanguage } from "@/lib/question-suggest";
import { runTask } from "@/lib/task-models";
import { recordUsage } from "@/lib/usage-store";
import { brandTerms, suggestPrompts } from "@/lib/visibility";
import { fetchProductSample, fetchSettings, fetchTopCategories } from "@/lib/woo";

// basis: "observed" when written from the store's products by a helper model, "heuristic" for the template fallback.
export type PromptState = { error?: string; suggestions?: string[]; source?: string; basis?: "observed" | "heuristic" };

// The store, only for its workspace's owners and admins (viewers only read).
async function ownedStore(storeId: string) {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const access = await storeAccess(supabase, user.id, storeId);
  return { supabase, user, store: access && canEdit(access.role) ? access : null };
}

// Adds one or more questions (typed, or accepted suggestions). Inserted as the user, so RLS checks ownership.
export async function addPrompts(_: PromptState, form: FormData): Promise<PromptState> {
  const storeId = String(form.get("store_id") ?? "");
  const { supabase, user, store } = await ownedStore(storeId);
  if (!store) return { error: "Store not found, or you can only view it." };

  // Picked suggestions: the ticked indexes, with the text as the user edited it.
  const picked = form.getAll("pick").map((i) => form.get(`text_${String(i)}`) ?? "");
  const texts = [...form.getAll("prompt"), ...form.getAll("accept"), ...picked].map((v) => String(v).replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!texts.length) return { error: "Write a question or pick a suggestion." };
  if (texts.some((t) => t.length < 3 || t.length > 300)) return { error: "Each question must be 3 to 300 characters." };

  const { count } = await supabase.from("visibility_prompts").select("id", { count: "exact", head: true }).eq("store_id", store.id);
  const limit = PLANS[await planOf(createAdminClient(), store.id)].visibilityQuestions;
  if ((count ?? 0) + texts.length > limit) return { error: `This plan allows ${limit} questions per store.` };

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

// Fifteen suggestions from the store's real products, categories and prices, in the chosen language, written by the
// task chain (Groq → NVIDIA → Gemini). Falls back to category templates (English). Nothing is saved until the user
// picks and edits them.
export async function suggest(_: PromptState, form: FormData): Promise<PromptState> {
  const { store } = await ownedStore(String(form.get("store_id") ?? ""));
  if (!store) return { error: "Store not found, or you can only view it." };
  const lang = String(form.get("language") ?? "en");
  const language: QuestionLanguage = lang in QUESTION_LANGUAGES ? (lang as QuestionLanguage) : "en";
  try {
    const admin = createAdminClient();
    const { data: creds } = await admin
      .rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: store.owner_id })
      .maybeSingle<{ consumer_key: string; consumer_secret: string }>();
    if (!creds) return { error: "No API key saved for this store." };
    const woo = { consumerKey: creds.consumer_key, consumerSecret: creds.consumer_secret };
    const [products, categories, settings] = await Promise.all([
      fetchProductSample(store.url, woo).catch(() => []),
      fetchTopCategories(store.url, woo).catch(() => []),
      fetchSettings(store.url, ["general"], woo),
    ]);
    const code = settings.ok ? (settings.data.woocommerce_default_country ?? "").split(":")[0] : "";
    const currency = settings.ok ? settings.data.woocommerce_currency ?? null : null;
    let country: string | null = null;
    try {
      country = code ? (new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? null) : null;
    } catch {
      country = null;
    }
    if (products.length) {
      const keys = brandTerms(store.name, store.url).keys ?? [];
      const t = await runTask({
        prompt: questionsPrompt({ products, categories, country, currency, language }),
        jsonSchema: QUESTIONS_JSON_SCHEMA,
        geminiSchema: QUESTIONS_GEMINI_SCHEMA,
        maxOutputTokens: 2048,
        validate: (text) => validateQuestions(text, keys),
      });
      const used: Record<string, { requests: number; input: number; output: number }> = {};
      for (const a of t.attempts) {
        const u = (used[a.by] ??= { requests: 0, input: 0, output: 0 });
        u.requests += a.requests;
        u.input += a.input;
        u.output += a.output;
      }
      await recordUsage(admin, { workspaceId: store.workspace_id, storeId: store.id, kind: "question_suggestions" }, used);
      if (t.value && t.by) {
        const who = t.by === "gemini" ? "Gemini" : `an internal helper model (${t.by === "groq" ? "Groq" : "NVIDIA"})`;
        return { suggestions: t.value, basis: "observed", source: `Written by ${who} from ${products.length} of your products.` };
      }
    }
    return {
      suggestions: suggestPrompts(categories, country),
      basis: "heuristic",
      source: products.length ? "The helper models could not write questions; these are templates from your categories (English)." : "No published products were found; these are templates from your categories (English).",
    };
  } catch {
    return { error: "Could not read the store's products." };
  }
}
