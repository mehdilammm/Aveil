import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations, getLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { BasisBadge, formatDate, SeverityBadge } from "@/components/badges";
import { PublicHeader } from "@/components/public-header";
import { ACCESS_NOTE, GEMINI_DISCLAIMER, GEMINI_LABEL, type GeminiPart, type GeminiParts, type PublicReport } from "@/lib/public-scan";
import { createAdminClient } from "@/lib/supabase/admin";
import { ENGINE_LABEL, TASK_BY_LABEL } from "@/lib/visibility";
import { ShareLink } from "./share-link";
import { WaitlistForm } from "./waitlist-form";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("report"))("metaTitle"), robots: { index: false } };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEV = { high: 0, medium: 1, low: 2 } as const;
const AREAS = ["product_data", "robots", "access", "structured_data", "store_pages", "ai_visibility"];

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { data: row } = await createAdminClient()
    .from("public_reports")
    .select("id, host, status, report, error, created_at, expires_at")
    .eq("id", id)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!row) notFound();
  const t = await getTranslations("report");

  if (row.status === "running") {
    return (
      <>
        <meta httpEquiv="refresh" content="5" />
        <PublicHeader />
        <main className="public-main">
          <div className="card empty"><strong>{t("checking", { host: row.host })}</strong><p>{t("checkingNote")}</p></div>
        </main>
      </>
    );
  }
  if (row.status === "failed" || !row.report) {
    return (
      <>
        <PublicHeader />
        <main className="public-main">
          <div className="card empty"><strong>{t("failed", { host: row.host })}</strong><p>{row.error ?? t("tryLater")}</p><Link className="button" href="/check">{t("tryAgain")}</Link></div>
        </main>
      </>
    );
  }

  const r = row.report as PublicReport;
  // Reports from before v2 had one Gemini question (by domain): show it as the knowledge question.
  const raw = r.gemini as PublicReport["gemini"] | GeminiPart;
  const gemini: GeminiParts = "visibility" in raw ? raw : { visibility: { status: "unavailable", reason: t("olderReport"), prompt: "" }, knowledge: raw };
  const findings = [...r.findings].sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  const products = r.pages.filter((p) => p.kind === "product");

  return (
    <>
      <PublicHeader />
      <main className="public-main">
        <div className="page-head">
          <h1>{r.host}</h1>
          <p className="sub">
            {t("checked", { date: formatDate(r.checkedAt, locale), used: r.requests, limit: r.requestLimit ?? 10 })}
            {r.servedVia && <> · {t("servedVia", { via: r.servedVia })}</>}
            {" · "}{t("platform", { name: r.platformName ?? (r.platform?.woocommerce ? "WooCommerce" : r.platform?.wordpress ? "WordPress" : t("unknown")) })}
          </p>
          <ShareLink path={`/check/${row.id}`} />
          <p className="muted small">{t("until", { date: formatDate(row.expires_at, locale) })}</p>
        </div>

        <h2>{t("findings", { n: findings.length })}</h2>
        {findings.length === 0 && <p className="notice">{t("nothing")}</p>}
        {findings.map((f) => (
          <div key={f.finding_key} className="card finding">
            <div className="row">
              <SeverityBadge severity={f.severity} />
              <BasisBadge basis={f.basis} />
              <span className="badge area-tag">{AREAS.includes(f.area) ? t(`area_${f.area}`) : f.area}</span>
            </div>
            <h3>{f.title}</h3>
            <p className="evidence">{f.evidence}</p>
            <p className="guidance"><strong>{t("howToFix")}</strong> {f.guidance}</p>
          </div>
        ))}

        <h2>robots.txt</h2>
        <div className="card table-wrap">
          <p className="muted small">{t("robotsFrom", { state: r.robots.status === "ok" ? t("found") : r.robots.detail })} {r.robots.sitemaps.length ? t("sitemap", { list: r.robots.sitemaps.join(", ") }) : t("noSitemap")}</p>
          {r.robots.verdicts.length > 0 && (
            <table>
              <thead><tr><th>{t("bot")}</th><th>{t("rule")}</th><th>{t("homePage")}</th></tr></thead>
              <tbody>
                {r.robots.verdicts.map((v) => (
                  <tr key={v.bot}>
                    <td>{v.bot}</td>
                    <td>{t(`v_${v.verdict === "not mentioned" ? "not_mentioned" : v.verdict}`)}</td>
                    <td className={v.effective === "blocked" ? "error" : "status-connected"}>{t(`v_${v.effective}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">llms.txt: {r.llmsTxt}.</p>
          {r.agentic && <p className="small"><BasisBadge basis={r.agentic.basis} /> {r.agentic.title}. <span className="muted">{r.agentic.evidence}</span></p>}
        </div>

        <h2>{t("access")}</h2>
        <div className="card">
          <BasisBadge basis="heuristic" />
          <p className="muted small">{ACCESS_NOTE}</p>
          {r.accessResults.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t("request")}</th><th>{t("homeAnswer")}</th></tr></thead>
                <tbody>
                  {r.pages[0] && <tr><td>{t("normalRequest")}</td><td>{r.pages[0].seen}</td></tr>}
                  {r.accessResults.map((a) => <tr key={a.bot}><td>{a.bot}</td><td>{a.seen}</td></tr>)}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">{r.protection ? t("notTestedWhy", { why: r.protection.reason }) : r.agentScopeBlocked ? t("notTestedRobots") : r.gate ? t("notTestedGate") : t("notTested")}</p>
          )}
        </div>

        {r.shopifyList && (
          <>
            <h2>{t("shopifyList")}</h2>
            <div className="card">
              {r.shopifyList.status === "ok" ? (
                <p className="small">{r.shopifyList.note} {t("productsRead", { n: r.shopifyList.checked })}</p>
              ) : (
                <p className="muted small">{t("listOff", { reason: r.shopifyList.reason })}</p>
              )}
            </div>
          </>
        )}

        {r.wooStoreApi && (
          <>
            <h2>{t("storeApi")}</h2>
            <div className="card">
              {r.wooStoreApi.status === "ok" ? (
                <p className="small">{r.wooStoreApi.note} {t("productsRead", { n: r.wooStoreApi.checked })}</p>
              ) : (
                <p className="muted small">{t("listOff", { reason: r.wooStoreApi.reason })}</p>
              )}
            </div>
          </>
        )}

        <h2>{t("productPages")}</h2>
        <div className="card">
          {products.length === 0 ? (
            <p className="muted">{t("noProductPage")}</p>
          ) : (
            products.map((p) => (
              <div key={p.url} style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
                <p className="small" style={{ wordBreak: "break-all" }}><a href={p.url} target="_blank" rel="noopener noreferrer nofollow">{p.url}</a></p>
                {p.schema && p.schema.readable === false ? (
                  <p className="small muted">{t("schemaUnreadable", { kind: p.schema.kind ?? "" })}</p>
                ) : p.schema ? (
                  <p className="small">
                    {t("schemaLine", { kind: p.schema.kind ?? "Product", name: p.schema.name ? "✓" : "✗", price: p.schema.price ?? "✗", currency: p.schema.currency ?? "✗", availability: p.schema.availability?.replace(/^https?:\/\/schema\.org\//, "") ?? "✗", image: p.schema.image ? "✓" : "✗" })}
                  </p>
                ) : (
                  <p className="small">{t("noSchema", { seen: p.seen })}</p>
                )}
                <p className="small">
                  {t("priceShown", { price: p.visiblePrice ?? t("priceNotFound") })}
                  {p.storePrice && <> · {t("storePrice", { price: p.storePrice })}</>}
                  {" · "}
                  {p.priceCheck === "match" ? (
                    <span className="status-connected">{t("matches")}{p.comparedWith ? ` (${p.comparedWith})` : ""}</span>
                  ) : p.priceCheck === "mismatch" ? (
                    <span className="error">{t("noMatch")}{p.comparedWith ? ` (${p.comparedWith})` : ""}</span>
                  ) : (
                    t("noCompare")
                  )}
                </p>
              </div>
            ))
          )}
          <p className="muted small">{t("foundFrom", { source: r.productSource })}</p>
        </div>

        <h2>{t("aiVisibility")}</h2>
        {gemini.topic && (
          <p className="muted small">
            {t("topic", { text: gemini.topic.text, how: gemini.topic.source === "title" ? t("topicTitle") : gemini.topic.source === "category links" ? t("topicCategories") : t("topicSummary", { by: gemini.topic.source === "gemini" ? "Gemini" : TASK_BY_LABEL[gemini.topic.source] }) })}
          </p>
        )}
        {gemini.visibilityMistral && (
          <div className="card table-wrap">
            <table>
              <thead><tr><th>{t("engine")}</th><th>{t("named")}</th><th>{t("instead")}</th></tr></thead>
              <tbody>
                {([["Gemini", gemini.visibility], ["Mistral", gemini.visibilityMistral]] as const).map(([name, part]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{part.status === "ok" ? (part.mentioned ? <span className="badge state-resolved">{t("yesNamed")}</span> : <span className="badge sev-medium">{t("notNamed")}</span>) : <span className="muted">{t("unavailable")}</span>}</td>
                    <td style={{ whiteSpace: "normal" }}>{part.status === "ok" ? (part.method === "failed" ? <span className="muted">{t("noExtract")}</span> : part.competitors.join(", ") || "—") : <span className="muted small">{part.reason}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <GeminiBlock
          part={gemini.visibility}
          empty={t("noGeneral")}
          verdict={(p) =>
            p.mentioned ? <span className="badge state-resolved">{t("namedInAnswer")}</span> : <span className="badge sev-medium">{t("notNamedInAnswer")}</span>
          }
          namesLabel={t("recommendedInstead")}
        />

        {gemini.visibilityMistral?.status === "ok" && (
          <GeminiBlock
            part={gemini.visibilityMistral}
            empty={t("noGeneral")}
            verdict={(p) =>
              p.mentioned ? <span className="badge state-resolved">{t("namedInAnswer")}</span> : <span className="badge sev-medium">{t("notNamedInAnswer")}</span>
            }
            namesLabel={t("recommendedInstead")}
          />
        )}

        <h2>{t("knowsTitle")}</h2>
        <GeminiBlock
          part={gemini.knowledge}
          empty={t("notAsked")}
          note={t("knowsNote")}
          namesLabel={t("similar")}
        />

        {gemini.tasks && gemini.tasks.length > 0 && (
          <>
            <h2>{t("tasks")}</h2>
            <div className="card table-wrap">
              <p className="muted small">{t("tasksNote")}</p>
              <table>
                <thead><tr><th>{t("task")}</th><th>{t("doneBy")}</th><th>{t("requests")}</th><th>{t("tokens")}</th><th>{t("triedBefore")}</th></tr></thead>
                <tbody>
                  {gemini.tasks.map((t, i) => (
                    <tr key={i}>
                      <td>{t.task}</td>
                      <td>{t.by}</td>
                      <td>{t.attempts.reduce((n, a) => n + a.requests, 0)}</td>
                      <td>{t.attempts.reduce((n, a) => n + a.input, 0)} / {t.attempts.reduce((n, a) => n + a.output, 0)}</td>
                      <td style={{ whiteSpace: "normal" }} className="muted small">{t.attempts.filter((a) => a.problem).map((a) => `${a.by}: ${a.problem}`).join("; ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {r.requestLog && r.requestLog.length > 0 && (
          <>
            <h2>{t("requests")}</h2>
            <div className="card table-wrap">
              <p className="muted small">{t("requestsNote", { used: r.requests, limit: r.requestLimit ?? 10 })}</p>
              <table>
                <thead><tr><th>{t("step")}</th><th>{t("result")}</th></tr></thead>
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
          <p>{t("ctaNote")}</p>
          {r.platform?.shopify ? (
            <>
              <p><strong>{t("shopifySoon")}</strong></p>
              <WaitlistForm reportId={row.id} />
            </>
          ) : (
            <>
              <p><strong>{t("fullTitle")}</strong> {t("fullText")}</p>
              <a className="button" href={`/check/${row.id}/continue`}>{t("fullCta")}</a>
            </>
          )}
        </div>
      </main>
    </>
  );
}

type OkPart = Extract<GeminiPart, { status: "ok" }>;

function GeminiBlock({ part, empty, note, verdict, namesLabel }: { part: GeminiPart; empty: string; note?: string; verdict?: (p: OkPart) => React.ReactNode; namesLabel: string }) {
  const t = useTranslations("report");
  return (
    <div className="card">
      <span className="badge basis-observed">{part.engine === "mistral" ? ENGINE_LABEL.mistral : GEMINI_LABEL}</span>
      {part.prompt ? <p className="small"><strong>{t("question")}</strong> {part.prompt}</p> : <p className="muted small">{part.status === "unavailable" ? part.reason : empty}</p>}
      {part.status === "ok" ? (
        <>
          {verdict && <p>{verdict(part)}</p>}
          {note && <p className="muted small">{note}</p>}
          {part.method === "failed" ? (
            <p className="muted small">{t("noNames")}{part.extractionError ? ` (${part.extractionError})` : ""}</p>
          ) : (
            part.competitors.length > 0 && <p className="small"><strong>{namesLabel}:</strong> {part.competitors.join(", ")}</p>
          )}
          <details>
            <summary className="muted small">{t("said", { engine: part.engine === "mistral" ? "Mistral" : "Gemini", model: part.model })}{part.extractor ? ` · ${t("namesBy", { by: part.extractor === "mistral" ? "Mistral" : TASK_BY_LABEL[part.extractor] })}` : ""}</summary>
            <blockquote style={{ borderInlineStart: "3px solid var(--border)", margin: "8px 0", paddingInlineStart: 12 }}>
              <pre style={{ whiteSpace: "pre-wrap", font: "inherit", fontSize: 14, margin: 0 }}>{part.answer}</pre>
            </blockquote>
          </details>
          {part.note && <p className="muted small">{part.note}</p>}
          <p className="muted small"><strong>{GEMINI_DISCLAIMER}</strong> {t("oneAnswer")}</p>
        </>
      ) : (
        part.prompt && <p className="muted">{t("notAvailable", { reason: part.reason })}{part.note ? ` ${part.note}` : ""}</p>
      )}
    </div>
  );
}
