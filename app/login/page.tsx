import { redirect } from "next/navigation";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SITE } from "@/lib/site";
import { afterAuthPath } from "@/lib/check-handoff";
import { getUser } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { AuthForm } from "./auth-form";

export async function generateMetadata() {
  return { title: (await getTranslations("login"))("title") };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string }> }) {
  const { user } = await getUser();
  if (user) redirect(await afterAuthPath());
  const { error, mode } = await searchParams;
  const signup = mode === "signup";
  const t = await getTranslations("login");
  return (
    <main className="auth">
      <p className="brand"><Link href="/">{SITE.name}</Link></p>
      <h1>{signup ? t("titleSignup") : t("title")}</h1>
      <p className="muted">{t("sub")}</p>
      {error && <p className="error">{error}</p>}
      <AuthForm signup={signup} />
      <SiteFooter />
    </main>
  );
}
