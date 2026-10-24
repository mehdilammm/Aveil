"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { afterAuthPath } from "@/lib/check-handoff";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; notice?: string };

function readForm(form: FormData) {
  return { email: String(form.get("email") ?? "").trim(), password: String(form.get("password") ?? "") };
}

export async function logIn(_: AuthState, form: FormData): Promise<AuthState> {
  const { email, password } = readForm(form);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  redirect(await afterAuthPath());
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const { email, password } = readForm(form);
  if (form.get("agree") !== "yes") return { error: "To sign up, tick the box to agree to the Terms and the Privacy Policy." };
  if (password.length < 8) return { error: "Use a password of at least 8 characters." };
  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });
  if (error) return { error: error.message };
  if (data.session) redirect(await afterAuthPath());
  return { notice: "Check your email to confirm your account, then log in." };
}
