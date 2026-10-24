import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BasisBadge, formatDate, SeverityBadge } from "@/components/badges";
import { PublicHeader } from "@/components/public-header";
import { hashShareToken, isShareToken, shareState, type ShareSnapshot } from "@/lib/share-report";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI agent readiness report", robots: { index: false, follow: false }, referrer: "no-referrer" };

// Public, read-only report (G3). Looks the link up by the hash of its token and shows only the frozen snapshot.
export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("share");
  const admin = createAdminClient();
  const { data: row } = isShareToken(token)
    ? await admin.from("share_reports").select("id, snapshot, expires_at, revoked_at, views").eq("token_hash", hashShareToken(token)).maybeSingle()
    : { data: null };
  const state = shareState(row);
  if (!row || state !== "ok") {
    const reason = state === "expired" ? t("goneExpired") : state === "revoked" ? t("goneRevoked") : t("goneMissing");
    return (
      <>
      <PublicHeader />
      <main className="public-main">
        <div className="card empty"><h1>{t("gone")}</h1><p>{reason}</p></div>
      </main>
      </>
    );
  }
  await admin.from("share_reports").update({ views: row.views + 1 }).eq("id", row.id);
  const s = row.snapshot as ShareSnapshot;

  return (
    <>
      <PublicHeader />
      <main className="public-main">
      <div className="page-head">
        <h1>{t("pageTitle", { host: s.store.host })}</h1>
        <p className="sub">{t("scannedOn", { date: formatDate(s.scan.finished_at), count: s.scan.scanned_products ?? 0 })}</p>
      </div>
      <p className="muted">{t("snapshotNote")}</p>
      <div className="card row">
        <span><SeverityBadge severity="high" /> {s.counts.high}</span>
        <span><SeverityBadge severity="medium" /> {s.counts.medium}</span>
        <span><SeverityBadge severity="low" /> {s.counts.low}</span>
        <span><BasisBadge basis="unavailable" /> {s.counts.unavailable}</span>
      </div>
      <h2>{t("byArea")}</h2>
      <div className="card table-wrap">
        <table>
          <tbody>
            {s.areas.map((a) => (
              <tr key={a.key}><td>{t(`area.${a.key}` as "area.feed")}</td><td className="num">{a.open}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>{t("findings")}</h2>
      {s.findings.length === 0 ? (
        <p className="muted">{t("noFindings")}</p>
      ) : (
        <div className="card table-wrap">
          <table>
            <tbody>
              {s.findings.map((f, i) => (
                <tr key={i}>
                  <td><SeverityBadge severity={f.severity} /></td>
                  <td><BasisBadge basis={f.basis} /></td>
                  <td>{f.title}</td>
                  <td className="muted">{t(`area.${f.area}` as "area.feed")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">{t("madeWith")}</p>
    </main>
    </>
  );
}
