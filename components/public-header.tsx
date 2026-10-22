import Link from "next/link";
import { SITE } from "@/lib/site";

export function PublicHeader() {
  return (
    <header className="sidebar public-header">
      <div className="brand-row">
        <Link href="/" className="brand">{SITE.name}</Link>
        <nav aria-label="Public" className="public-nav">
          <Link href="/check">Free check</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/login">Log in</Link>
        </nav>
      </div>
    </header>
  );
}
