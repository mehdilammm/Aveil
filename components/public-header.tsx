import Link from "next/link";

export function PublicHeader() {
  return (
    <header className="sidebar public-header">
      <div className="brand-row">
        <Link href="/check" className="brand">AgentScope</Link>
        <nav aria-label="Public" className="public-nav">
          <Link href="/check">Free check</Link>
          <Link href="/bot">Our bot</Link>
          <Link href="/login">Log in</Link>
        </nav>
      </div>
    </header>
  );
}
