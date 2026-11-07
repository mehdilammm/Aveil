import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LineChart, Legend } from "@/components/charts";
import { InfoPage } from "@/components/info-page";
import { CASE_AFTER, CASE_BEFORE, CASE_SCANS, CASE_SIM } from "@/lib/case-study";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("caseStudy"))("title"), alternates: { canonical: "/case-study" } };
}

const MARK = { ok: "✓", warn: "!", stop: "✗", skip: "–" } as const;

export default async function CaseStudyPage() {
  const t = await getTranslations("caseStudy");
  const ts = await getTranslations("agentSim");
  return (
    <InfoPage title={t("title")} sub={t("sub")}>
      <p><span className="badge">{t("label")}</span></p>

      <section className="card">
        <h2>{t("s1Title")}</h2>
        <div className="case-ba">
          <div className="case-num before"><span className="muted small">{t("before")}</span><strong>{CASE_BEFORE.issues}</strong><span className="small">{t("issuesLabel")}</span><strong>{CASE_BEFORE.critical}</strong><span className="small">{t("criticalLabel")}</span></div>
          <span className="case-arrow" aria-hidden="true">→</span>
          <div className="case-num after"><span className="muted small">{t("after")}</span><strong>{CASE_AFTER.issues}</strong><span className="small">{t("issuesLabel")}</span><strong>{CASE_AFTER.critical}</strong><span className="small">{t("criticalLabel")}</span></div>
        </div>
        <p>{t("s1Text", { before: CASE_BEFORE.issues, critical: CASE_BEFORE.critical, after: CASE_AFTER.issues })}</p>
        <Legend items={[{ name: t("issuesLabel"), tone: 1 }]} />
        <LineChart points={CASE_SCANS.map((s) => ({ at: s.at, value: s.issues }))} label={t("issuesLabel")} seriesName={t("issuesLabel")} valueLabel={(p, d) => `${d}: ${p.value}`} empty={null} />
        <Legend items={[{ name: t("criticalLabel"), tone: 1 }]} />
        <LineChart points={CASE_SCANS.map((s) => ({ at: s.at, value: s.critical }))} label={t("criticalLabel")} seriesName={t("criticalLabel")} valueLabel={(p, d) => `${d}: ${p.value}`} empty={null} />
        <p className="muted small">{t("s1Note")}</p>
      </section>

      <section className="card">
        <h2>{t("s2Title")}</h2>
        <p>{t("s2Text")}</p>
        <p className="muted small">{t("targetNote")}</p>
        <div className="case-sims">
          {CASE_SIM.map((sim) => (
            <div key={sim.market} className="case-sim">
              <h3>{t(sim.market === "US" ? "marketUS" : "marketMA")}</h3>
              <p><strong>{sim.stoppedAt ? ts("stopped", { step: ts(`step.${sim.stoppedAt}`) }) : ts("reached")}</strong></p>
              <ol className="small case-steps">
                {sim.steps.map((x, i) => (
                  <li key={i} className={`o-${x.outcome}`}><span aria-hidden="true">{MARK[x.outcome]}</span> {ts(`step.${x.step}`)}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <p className="guidance">{t("s2Fix")}</p>
      </section>

      <section className="card">
        <h2>{t("s3Title")}</h2>
        <p>{t("s3Text")}</p>
        <Link className="button" href="/check">{t("cta")}</Link>
      </section>
    </InfoPage>
  );
}
