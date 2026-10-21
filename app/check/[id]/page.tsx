import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BasisBadge, formatDate, SeverityBadge } from "@/components/badges";
import { PublicHeader } from "@/components/public-header";
import { ACCESS_NOTE, GEMINI_DISCLAIMER, GEMINI_LABEL, type GeminiPart, type GeminiParts, type PublicReport } from "@/lib/public-scan";
import { createAdminClient } from "@/lib/supabase/admin";
import { ENGINE_LABEL } from "@/lib/visibility";
import { ShareLink } from "./share-link";
import { WaitlistForm } from "./waitlist-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI agent readiness report – AgentScope", robots: { index: false } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEV = { high: 0, medium: 1, low: 2 } as const;
const AREA_LABEL: Record<string, string> = { product_data: "Product data", robots: "robots.txt", access: "Bot access", structured_data: "Structured data", store_pages: "Store", ai_visibility: "Gemini" };

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
  // Reports from before v2 had one Gemini question (by domain): show it as the knowledge question.
  const raw = r.gemini as PublicReport["gemini"] | GeminiPart;
  const gemini: GeminiParts = "visibility" in raw ? raw : { visibility: { status: "unavailable", reason: "Not part of this older report.", prompt: "" }, knowledge: raw };
  const findings = [...r.findings].sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  const products = r.pages.filter((p) => p.kind === "product");

  return (
    <>
      <PublicHeader />
      <main className="public-main">
        <div className="page-head">
          <h1>{r.host}</h1>
          <p className="sub">
            Checked {formatDate(r.checkedAt)} · Requests used: {r.requests} of {r.requestLimit ?? 10}
            {r.servedVia && <> · served via {r.servedVia}</>}
            {" · "}Platform: {r.platformName ?? (r.platform?.woocommerce ? "WooCommerce" : r.platform?.wordpress ? "WordPress" : "unknown")}
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
            <p className="muted">Not tested{r.protection ? `: ${r.protection.reason}` : r.agentScopeBlocked ? ": robots.txt asks AgentScopeBot not to crawl" : r.gate ? ": the store shows a Coming soon or maintenance page" : ""}.</p>
          )}
        </div>

        {r.shopifyList && (
          <>
            <h2>Shopify product list</h2>
            <div className="card">
              {r.shopifyList.status === "ok" ? (
                <p className="small">{r.shopifyList.note} {r.shopifyList.checked} product{r.shopifyList.checked === 1 ? "" : "s"} read; findings are listed above under Product data.</p>
              ) : (
                <p className="muted small">Not available: {r.shopifyList.reason}. This is not a problem; many stores turn it off.</p>
              )}
            </div>
          </>
        )}

        <h2>Product pages</h2>
        <div className="card">
          {products.length === 0 ? (
            <p className="muted">No product page was checked.</p>
          ) : (
            products.map((p) => (
              <div key={p.url} style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
                <p className="small" style={{ wordBreak: "break-all" }}><a href={p.url} target="_blank" rel="noopener noreferrer nofollow">{p.url}</a></p>
                {p.schema && p.schema.readable === false ? (
                  <p className="small muted">JSON-LD {p.schema.kind} found, but its fields could not be read.</p>
                ) : p.schema ? (
                  <p className="small">
                    JSON-LD {p.schema.kind ?? "Product"}: name {p.schema.name ? "✓" : "✗"} · price {p.schema.price ?? "✗"} · currency {p.schema.currency ?? "✗"} · availability{" "}
                    {p.schema.availability?.replace(/^https?:\/\/schema\.org\//, "") ?? "✗"} · image {p.schema.image ? "✓" : "✗"}
                  </p>
                ) : (
                  <p className="small">No JSON-LD Product. Page: {p.seen}.</p>
                )}
                <p className="small">
                  Price shown on the page: {p.visiblePrice ?? "not found (or only monthly / installment amounts)"}
                  {p.storePrice && <> · store product list: {p.storePrice}</>}
                  {" · "}
                  {p.priceCheck === "match" ? (
                    <span className="status-connected">structured data matches{p.comparedWith ? ` the ${p.comparedWith}` : ""}</span>
                  ) : p.priceCheck === "mismatch" ? (
                    <span className="error">structured data does not match{p.comparedWith ? ` the ${p.comparedWith}` : ""}</span>
                  ) : (
                    "could not compare"
                  )}
                </p>
              </div>
            ))
          )}
          <p className="muted small">Found from: {r.productSource}.</p>
        </div>

        <h2>AI visibility</h2>
        {gemini.visibilityMistral && (
          <div className="card table-wrap">
            <table>
              <thead><tr><th>Engine</th><th>Your store named?</th><th>Stores named instead</th></tr></thead>
              <tbody>
                {([["Gemini", gemini.visibility], ["Mistral", gemini.visibilityMistral]] as const).map(([name, part]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{part.status === "ok" ? (part.mentioned ? <span className="badge state-resolved">Named</span> : <span className="badge sev-medium">Not named</span>) : <span className="muted">unavailable</span>}</td>
                    <td style={{ whiteSpace: "normal" }}>{part.status === "ok" ? (part.method === "failed" ? <span className="muted">could not extract</span> : part.competitors.join(", ") || "—") : <span className="muted small">{part.reason}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <GeminiBlock
          part={gemini.visibility}
          empty="No general question was asked."
          verdict={(p) =>
            p.mentioned ? <span className="badge state-resolved">Your store is named in the answer</span> : <span className="badge sev-medium">Your store is not named in the answer</span>
          }
          namesLabel="Stores recommended instead"
        />

        {gemini.visibilityMistral && (
          <GeminiBlock
            part={gemini.visibilityMistral}
            empty="No general question was asked."
            verdict={(p) =>
              p.mentioned ? <span className="badge state-resolved">Your store is named in the answer</span> : <span className="badge sev-medium">Your store is not named in the answer</span>
            }
            namesLabel="Stores recommended instead"
          />
        )}

        <h2>Does Gemini know this store?</h2>
        <GeminiBlock
          part={gemini.knowledge}
          empty="Not asked."
          note="This question names your domain, so the answer always mentions it. It shows what the model says about the store, not whether it recommends it."
          namesLabel="Similar stores named"
        />

        {r.requestLog && r.requestLog.length > 0 && (
          <>
            <h2>Requests</h2>
            <div className="card table-wrap">
              <p className="muted small">Requests used: {r.requests} of {r.requestLimit ?? 10}. Steps run in order of importance; redirect hops count as requests.</p>
              <table>
                <thead><tr><th>Step</th><th>Result</th></tr></thead>
                <tbody>
                  {r.requestLog.map((e, i) => (
                    <tr key={i}>
                      <td>{e.step}</td>
                      <td className={e.outcome.startsWith("not checked") ? "muted" : undefined}>{e.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="cta">
          <p>This public check sees only what any visitor sees.</p>
          {r.platform?.shopify ? (
            <>
              <p><strong>Full Shopify scan is coming. Join the waitlist.</strong></p>
              <WaitlistForm reportId={row.id} />
            </>
          ) : (
            <>
              <p>
                <strong>Full scan with a read-only key.</strong> Prices, stock, weights, feed readiness and weekly tracking for every product need a read-only
                WooCommerce key from the store owner.
              </p>
              <Link className="button" href="/login">Sign up</Link>
            </>
          )}
        </div>
      </main>
    </>
  );
}

type OkPart = Extract<GeminiPart, { status: "ok" }>;

function GeminiBlock({ part, empty, note, verdict, namesLabel }: { part: GeminiPart; empty: string; note?: string; verdict?: (p: OkPart) => React.ReactNode; namesLabel: string }) {
  return (
    <div className="card">
      <span className="badge basis-observed">{part.engine === "mistral" ? ENGINE_LABEL.mistral : GEMINI_LABEL}</span>
      {part.prompt ? <p className="small"><strong>Question:</strong> {part.prompt}</p> : <p className="muted small">{part.status === "unavailable" ? part.reason : empty}</p>}
      {part.status === "ok" ? (
        <>
          {verdict && <p>{verdict(part)}</p>}
          {note && <p className="muted small">{note}</p>}
          {part.method === "failed" ? (
            <p className="muted small">Could not extract store names from this answer{part.extractionError ? ` (${part.extractionError})` : ""}.</p>
          ) : (
            part.competitors.length > 0 && <p className="small"><strong>{namesLabel}:</strong> {part.competitors.join(", ")}</p>
          )}
          <details>
            <summary className="muted small">What {part.engine === "mistral" ? "Mistral" : "Gemini"} said ({part.model}, no web search){part.extractor ? ` · names read by ${part.extractor === "mistral" ? "Mistral" : "Gemini"}` : ""}</summary>
            <blockquote style={{ borderLeft: "3px solid var(--border)", margin: "8px 0", paddingLeft: 12 }}>
              <pre style={{ whiteSpace: "pre-wrap", font: "inherit", fontSize: 14, margin: 0 }}>{part.answer}</pre>
            </blockquote>
          </details>
          <p className="muted small"><strong>{GEMINI_DISCLAIMER}</strong> One answer from the API; the Gemini app and other runs can answer differently.</p>
        </>
      ) : (
        part.prompt && <p className="muted">Not available: {part.reason}</p>
      )}
    </div>
  );
}
