import { PublicHeader } from "./public-header";
import { SiteFooter } from "./site-footer";

// A short public page (About, Security, Refunds, Contact, Glossary, Case study): header, title, content, footer.
export function InfoPage({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <>
      <PublicHeader />
      <main className="public-main info-page">
        <div className="page-head">
          <div>
            <h1>{title}</h1>
            {sub && <p className="sub">{sub}</p>}
          </div>
        </div>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
