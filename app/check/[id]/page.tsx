import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BasisBadge, formatDate, SeverityBadge } from "@/components/badges";
import { PublicHeader } from "@/components/public-header";
import { ACCESS_NOTE, GEMINI_LABEL, type PublicReport } from "@/lib/public-scan";
import { createAdminClient } from "@/lib/supabase/admin";
import { ShareLink } from "./share-link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI agent readiness report – AgentScope", robots: { index: false } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEV = { high: 0, medium: 1, low: 2 } as const;
const AREA_LABEL: Record<string, string> = { robots: "robots.txt", access: "Bot access", structured_data: "Structured data", store_pages: "Store", ai_visibility: "Gemini" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { data: row } = await createAdminClient()
    .from("public_reports")
    .select("id, host, status, report, error, created_at, expires_at")
    .eq("id", id)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!row) notFound();

  if (row.status === "running") {
    return (
      <>
        <meta httpEquiv="refresh" content="5" />
        <PublicHeader />
        <main className="public-main">
          <div className="card empty"><strong>Checking {row.host}…</strong><p>This takes up to two minutes. The page refreshes by itself.</p></div>
        </main>
      </>
    );
  }
  if (row.status === "failed" || !row.report) {
    return (
      <>
        <PublicHeader />
        <main className="public-main">
          <div className="card empty"><strong>The check of {row.host} could not finish</strong><p>{row.error ?? "Please try again."}</p><Link className="button" href="/check">Try again</Link></div>
        </main>
      </>
    );
  }

  const r = row.report as PublicReport;
  const findings = [...r.findings].sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  const products = r.pages.filter((p) => p.kind === "product");

  return (
    <>
      <PublicHeader />
      <main className="public-main">
        <div className="page-head">
          <h1>{r.host}</h1>
          <p className="sub">
            Checked {formatDate(r.checkedAt)} · {r.requests} requests to the store
            {r.platform && <> · {r.platform.woocommerce ? "WooCommerce detected" : r.platform.wordpress ? "WordPress, WooCommerce not detected" : "WooCommerce not detected"}</>}
          </p>
          <ShareLink path={`/check/${row.id}`} />
          <p className="muted small">This link works until {formatDate(row.expires_at)}.</p>
        </div>

        <h2>Findings ({findings.length})</h2>
        {findings.length === 0 && <p className="notice">Nothing to fix in what a visitor can see.</p>}
        {findings.map((f) => (
          <div key={f.finding_key} className="card finding">
            <div className="row">
              <SeverityBadge severity={f.severity} />
              <BasisBadge basis={f.basis} />
              <span className="badge area-tag">{AREA_LABEL[f.area] ?? f.area}</span>
            </div>
            <h3>{f.title}</h3>
            <p className="evidence">{f.evidence}</p>
            <p className="guidance"><strong>How to fix:</strong> {f.guidance}</p>
          </div>
        ))}

        <h2>robots.txt</h2>
        <div className="card table-wrap">
          <p className="muted small">From the rules written in robots.txt ({r.robots.status === "ok" ? "found" : r.robots.detail}). {r.robots.sitemaps.length ? `Sitemap: ${r.robots.sitemaps.join(", ")}` : "No sitemap listed."}</p>
          {r.robots.verdicts.length > 0 && (
            <table>
              <thead><tr><th>Bot</th><th>Rule for this bot</th><th>Home page</th></tr></thead>
              <tbody>
                {r.robots.verdicts.map((v) => (
                  <tr key={v.bot}>
                    <td>{v.bot}</td>
                    <td>{v.verdict}</td>
                    <td className={v.effective === "blocked" ? "error" : "status-connected"}>{v.effective}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">llms.txt: {r.llmsTxt}.</p>
        </div>

        <h2>Bot access</h2>
        <div className="card">
          <span className="badge basis-heuristic">Heuristic</span>
          <p className="muted small">{ACCESS_NOTE}</p>
          {r.accessResults.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Request</th><th>Home page answer</th></tr></thead>
                <tbody>
                  {r.pages[0] && <tr><td>AgentScopeBot (normal)</td><td>{r.pages[0].seen}</td></tr>}
                  {r.accessResults.map((a) => <tr key={a.bot}><td>{a.bot}</td><td>{a.seen}</td></tr>)}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Not tested{r.agentScopeBlocked ? ": robots.txt asks AgentScopeBot not to crawl" : r.gate ? ": the store shows a Coming soon or maintenance page" : ""}.</p>
          )}
        </div>

        <h2>Product pages</h2>
        <div className="card">
          {products.length === 0 ? (
            <p className="muted">No product page was checked.</p>
          ) : (
            products.map((p) => (
              <div key={p.url} style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
                <p className="small" style={{ wordBreak: "break-all" }}><a href={p.url} target="_blank" rel="noopener noreferrer nofollow">{p.url}</a></p>
                {p.schema ? (
                  <p className="small">
                    JSON-LD Product: name {p.schema.name ? "✓" : "✗"} · price {p.schema.price ?? "✗"} · currency {p.schema.currency ?? "✗"} · availability{" "}
                    {p.schema.availability?.replace(/^https?:\/\/schema\.org\//, "") ?? "✗"} · image {p.schema.image ? "✓" : "✗"}
                  </p>
                ) : (
                  <p className="small">No JSON-LD Product. Page: {p.seen}.</p>
                )}
                <p className="small">
                  Price shown on the page: {p.visiblePrice ?? "not found"} · {p.priceCheck === "match" ? <span className="status-connected">matches</span> : p.priceCheck === "mismatch" ? <span className="error">does not match</span> : "could not compare"}
                </p>
              </div>
            ))
          )}
          <p className="muted small">Found from: {r.productSource}.</p>
        </div>

        <h2>Gemini</h2>
        <div className="card">
          <span className="badge basis-observed">{GEMINI_LABEL}</span>
          <p className="small"><strong>Question:</strong> {r.gemini.prompt}</p>
          {r.gemini.status === "ok" ? (
            <>
              <p>{r.gemini.mentioned ? <span className="badge state-resolved">Your domain is named in the answer</span> : <span className="badge sev-medium">Your domain is not named in the answer</span>}</p>
              {r.gemini.competitors.length > 0 && <p className="small"><strong>Also named:</strong> {r.gemini.competitors.join(", ")}</p>}
              <details>
                <summary className="muted small">Full answer ({r.gemini.model}, no web search)</summary>
                <pre style={{ whiteSpace: "pre-wrap", font: "inherit", fontSize: 14 }}>{r.gemini.answer}</pre>
              </details>
              <p className="muted small">One answer from the API, without web search. The Gemini app and other runs can answer differently. This is not proof that AI recommends or ignores your store.</p>
            </>
          ) : (
            <p className="muted">Not available: {r.gemini.reason}</p>
          )}
        </div>

        <div className="cta">
          <p>
            This public check sees only what any visitor sees. The full scan (prices, stock, weights, feed readiness, weekly tracking) needs a read-only key
            from the store owner.
          </p>
          <Link className="button" href="/login">Sign up</Link>
        </div>
      </main>
    </>
  );
}
