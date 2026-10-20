import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { AuthForm } from "./auth-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { user } = await getUser();
  if (user) redirect("/stores");
  const { error } = await searchParams;
  return (
    <>
      <h1>Log in or sign up</h1>
      <p className="muted">Check whether your WooCommerce store is ready for AI shopping agents.</p>
      {error && <p className="error">{error}</p>}
      <AuthForm />
    </>
  );
}
