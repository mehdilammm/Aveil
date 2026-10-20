import type { Metadata } from "next";
import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentScope",
  description: "Check whether your WooCommerce store is ready for AI shopping agents.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getUser();
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/">AgentScope</Link>
          {user && (
            <form action="/auth/signout" method="post" className="row">
              <span className="muted">{user.email}</span>
              <button className="secondary" type="submit">Log out</button>
            </form>
          )}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
