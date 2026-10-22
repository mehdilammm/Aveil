import Link from "next/link";
import { SITE } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="Footer" className="row">
        <Link href="/check">Free check</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/bot">Our bot</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
      </nav>
      <p className="muted small">© {new Date().getUTCFullYear()} {SITE.name}. Read-only checks; no promise of AI visibility or sales.</p>
    </footer>
  );
}
