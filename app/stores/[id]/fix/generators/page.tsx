import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BasisBadge } from "@/components/badges";
import { CopyBox } from "@/components/copy-box";
import { generatorInputs } from "@/lib/fixes/inputs";
import { buildLlmsTxt } from "@/lib/fixes/llms-txt";
import { patchRobots, TRAINING_CRAWLERS, type TrainingChoice } from "@/lib/fixes/robots-patch";
import { wafGuide } from "@/lib/fixes/waf";
import { getStore } from "@/lib/data";
import { isAllowed, parseRobots } from "@/lib/robots";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// Copyable fixes built from the store's real data: robots.txt patch, firewall guidance, llms.txt.
export default async function GeneratorsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ training?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { supabase, user } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const t = await getTranslations("generators");
  const access = user ? await storeAccess(supabase, user.id, store.id) : null;
  if (!access || !canEdit(access.role)) return <div className="card"><p>{t("editorsOnly")}</p></div>;

  const admin = createAdminClient();
  const { data: creds } = await admin.rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: access.owner_id }).maybeSingle<{ consumer_key: string; consumer_secret: string }>();
  if (!creds) return <div className="card"><p><BasisBadge basis="unavailable" /> {t("noKey")}</p></div>;
  const inputs = await generatorInputs(admin, access, { consumerKey: creds.consumer_key, consumerSecret: creds.consumer_secret });

  // The training choice: what the merchant picks here; by default, what the current file already does for GPTBot.
  const current: TrainingChoice = isAllowed(parseRobots(inputs.robots.text), "GPTBot", "/") ? "allow" : "block";
  const training: TrainingChoice = sp.training === "allow" || sp.training === "block" ? sp.training : current;
  const robots = patchRobots(inputs.robots.text, training, inputs.productPath);
  const llms = buildLlmsTxt(inputs.llms);
  const waf = wafGuide(inputs.waf);
  const base = `/stores/${store.id}/fix/generators`;

  return (
    <>
      <p><Link href={`/stores/${store.id}/fix`}>← {t("back")}</Link></p>
      <div className="page-head">
        <h1>{t("title")}</h1>
        <p className="sub">{t("sub")}</p>
      </div>
      {inputs.unavailable.length > 0 && (
        <div className="card">
          {inputs.unavailable.map((u) => <p key={u} className="small"><BasisBadge basis="unavailable" /> {u}</p>)}
        </div>
      )}

      <h2>{t("robotsTitle")}</h2>
      <div className="card stack">
        <p className="small">{t("robotsIntro")}</p>
        <p className="small">
          {t("trainingLabel", { bots: TRAINING_CRAWLERS.join(", ") })}{" "}
          {(["allow", "block"] as const).map((c) => (
            <Link key={c} href={`${base}?training=${c}`} className={`badge ${c === training ? "basis-observed" : "basis-unavailable"}`} style={{ marginInlineEnd: 6 }} aria-current={c === training}>
              {t(c === "allow" ? "trainingAllow" : "trainingBlock")}
            </Link>
          ))}
        </p>
        {robots.unchanged ? (
          <p className="notice">{t("robotsUnchanged")}</p>
        ) : (
          <>
            <CopyBox text={robots.text} filename="robots.txt" rows={16} />
            {robots.removed.length > 0 && <p className="muted small">{t("robotsRemoved", { lines: robots.removed.join(" · ") })}</p>}
          </>
        )}
        <p className="small">
          {robots.problems.length === 0 ? <><BasisBadge basis="observed" /> {t("robotsValid", { n: robots.checks.length })}</> : <span className="error">{t("robotsInvalid", { problems: robots.problems.join("; ") })}</span>}
        </p>
        <details>
          <summary className="small">{t("wpHow")}</summary>
          <ol className="steps small">
            <li>{t("wp1")}</li>
            <li>{t("wp2")}</li>
            <li>{t("wp3")}</li>
            <li>{t("wp4")}</li>
          </ol>
        </details>
      </div>

      <h2>{t("wafTitle")}</h2>
      <div className="card stack">
        <p className="small"><BasisBadge basis="heuristic" /> {t("wafIntro", { vendor: waf.vendor })}</p>
        <ol className="steps small">{waf.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className="muted small">{t("wafLists")}</p>
        <ul className="small">{waf.verifyLists.map((l) => <li key={l} dir="ltr">{l}</li>)}</ul>
      </div>

      <h2>{t("llmsTitle")}</h2>
      <div className="card stack">
        <p className="small">{t("llmsIntro")}</p>
        <CopyBox text={llms.text} filename="llms.txt" rows={16} />
        {llms.missing.length > 0 && <p className="muted small">{t("llmsMissing", { list: llms.missing.join(", ") })}</p>}
        <p className="muted small">{t("llmsHow", { url: `${store.url}/llms.txt` })}</p>
      </div>
    </>
  );
}
