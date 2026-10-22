import { redirect } from "next/navigation";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SITE } from "@/lib/site";
import { getUser } from "@/lib/supabase/server";
import { AuthForm } from "./auth-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string }> }) {
  const { user } = await getUser();
  if (user) redirect("/stores");
  const { error, mode } = await searchParams;
  const signup = mode === "signup";
  return (
    <main className="auth">
      <p className="brand"><Link href="/">{SITE.name}</Link></p>
      <h1>{signup ? "Create your account" : "Log in or sign up"}</h1>
      <p className="muted">Check whether your WooCommerce store is ready for AI shopping agents.</p>
      {error && <p className="error">{error}</p>}
      <AuthForm signup={signup} />
      <SiteFooter />
    </main>
  );
}
