import { EmptyState, PageHead } from "@/components/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BasisBadge, formatDate } from "@/components/badges";
import { PlanLock } from "@/components/plan-lock";
import { lastCheck, type BreakageDetail, type Change, type LastCheck } from "@/lib/breakage";
import { getStore } from "@/lib/data";
import { storePlan } from "@/lib/plan-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";
import { DismissButton } from "./dismiss-button";

export const dynamic = "force-dynamic";

type Alert = { id: string; kind: "breakage" | "product_check" | "fix_reapplied" | "fix_lost" | "fix_rolled_back" | "first_ai_order"; status: string; title: string; detail: Record<string, unknown>; created_at: string };
type ProductDetail = { product: { id: number; name: string; url: string | null }; issues: { title: string; severity: string; basis: string }[]; fixed: { describe: string; verify: string | null }[]; auto_fix: "on" | "off" | "plan" };

// F2 / F3: what broke after a store change, and the checks of products just published or updated.
export default async function AlertsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const access = user ? await storeAccess(supabase, user.id, store.id) : null;
  if (!access) notFound();
  const t = await getTranslations("alerts");
  const plan = await storePlan(createAdminClient(), store.id);
  const { data } = await supabase.from("store_alerts").select("id, kind, status, title, detail, created_at").eq("store_id", store.id).order("created_at", { ascending: false }).limit(50);
  const alerts = (data ?? []) as Alert[];
  const editor = canEdit(access.role);
  // The latest breakage check and the changes it followed (job steps are server-only, read with the admin client).
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, status, updated_at, run_after, error").eq("store_id", store.id).eq("kind", "breakage_check").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const [{ data: changes }, { data: stepRow }] = job
    ? await Promise.all([
        supabase.from("store_events").select("kind, subject, old_version, new_version, occurred_at").eq("store_id", store.id).eq("job_id", job.id),
        admin.from("job_steps").select("result").eq("job_id", job.id).eq("step_key", "check").maybeSingle(),
      ])
    : [{ data: [] }, { data: null }];
  const last = lastCheck(job, (changes ?? []) as Change[], (stepRow?.result ?? null) as { checked?: number; new_problems?: number } | null);

  return (
    <>
      <PageHead title={t("title")} icon="alert" sub={t("sub")} />
      <p className="muted small">{t("note")}</p>
      {!plan.breakageAlerts && <PlanLock feature="breakageAlerts" />}
      {last && <LastCheckCard last={last} t={t} />}
      {alerts.length === 0 && <EmptyState icon="check" title={t("none")} />}
      {alerts.map((a) => (
        <div key={a.id} className={`card${a.status === "open" ? "" : " finding-resolved"}`}>
          {a.kind === "breakage" ? <Breakage d={a.detail as unknown as BreakageDetail} t={t} /> : a.kind === "product_check" ? <ProductCheck d={a.detail as unknown as ProductDetail} t={t} /> : a.kind === "first_ai_order" ? <><h3>{t("firstOrderTitle")}</h3><p><BasisBadge basis="observed" /> {a.title}</p></> : <Healing kind={a.kind} title={a.title} d={a.detail as unknown as HealDetail} t={t} />}
          <p className="muted small">{formatDate(a.created_at)} · {a.status === "open" ? t("open") : t("dismissed")}</p>
          <div className="row">
            <Link className="small" href={`/stores/${store.id}/fix`}>{t("fix")}</Link>
            {editor && a.status === "open" && <DismissButton storeId={store.id} alertId={a.id} />}
          </div>
        </div>
      ))}
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"alerts">>>;

function Breakage({ d, t }: { d: BreakageDetail; t: T }) {
  const c = d.change;
  return (
    <>
      <h3>{t("breakageTitle")}</h3>
      {d.problems.map((p) => (
        <p key={p.finding_key}>
          {t("after", { kind: c.kind, subject: c.subject ?? "", old: c.old_version ?? "?", new: c.new_version ?? "?", date: formatDate(c.occurred_at) })}{" "}
          <BasisBadge basis={p.basis} /> {p.title}. <span className="muted small">{p.evidence}</span>
        </p>
      ))}
      <p className="small"><BasisBadge basis="heuristic" /> {t("likely", { n: d.changes })}</p>
    </>
  );
}

function LastCheckCard({ last, t }: { last: LastCheck; t: T }) {
  const c = last.change;
  const after = c ? t("after", { kind: c.kind, subject: c.subject ?? "", old: c.old_version ?? "?", new: c.new_version ?? "?", date: formatDate(c.occurred_at) }) : t("lastNoChange");
  return (
    <div className="card">
      <h3>{t("lastTitle")}</h3>
      <p>
        {after}{" "}
        {last.state === "clean" && <><BasisBadge basis="observed" /> {t("lastClean", { n: last.checked })}</>}
        {last.state === "alert" && <><BasisBadge basis="observed" /> {t("lastAlert", { n: last.problems })}</>}
        {last.state === "pending" && <><BasisBadge basis="unavailable" /> {t("lastPending", { date: formatDate(last.at) })}</>}
        {last.state === "failed" && <><BasisBadge basis="unavailable" /> {t("lastFailed", { error: last.error })}</>}
      </p>
      {last.state !== "pending" && <p className="muted small">{t("lastAt", { date: formatDate(last.at) })}</p>}
    </div>
  );
}

// G9 / G10: a fix of ours put back, gone again, or undone after a new problem.
type HealDetail = { why?: string; verify?: string | null; evidence?: string | null; problem?: { title: string; evidence: string }; error?: string | null };
function Healing({ kind, title, d, t }: { kind: "fix_reapplied" | "fix_lost" | "fix_rolled_back"; title: string; d: HealDetail; t: T }) {
  return (
    <>
      <h3>{t(`healTitle_${kind}`)}</h3>
      <p>{title}</p>
      {d.why && <p className="small"><BasisBadge basis="observed" /> {t("healWhy", { why: d.why })}</p>}
      {d.problem && <p className="small"><BasisBadge basis="observed" /> {t("rollbackProblem", { title: d.problem.title })} <span className="muted">{d.problem.evidence}</span></p>}
      {d.error && <p className="error small">{d.error}</p>}
      {kind !== "fix_lost" && <p className="small"><BasisBadge basis={d.verify === "resolved" || d.verify === "still_open" ? "observed" : "unavailable"} /> {t("healVerify", { status: t(d.verify === "resolved" || d.verify === "still_open" ? `healV_${d.verify}` : "healV_unavailable") })}</p>}
      <p className="muted small">{kind === "fix_lost" ? t("healLost") : kind === "fix_reapplied" ? t("healReapplied") : t("rollbackNote")}</p>
    </>
  );
}

function ProductCheck({ d, t }: { d: ProductDetail; t: T }) {
  return (
    <>
      <h3>{d.product.url ? <a href={d.product.url} target="_blank" rel="noopener noreferrer">{d.product.name}</a> : d.product.name}</h3>
      <p>{t("productLine", { issues: d.issues.length, fixed: d.fixed.length })}</p>
      {d.issues.length > 0 && <ul className="small">{d.issues.map((i, n) => <li key={n}><BasisBadge basis={i.basis} /> {i.title}</li>)}</ul>}
      {d.fixed.length > 0 && <ul className="small">{d.fixed.map((f, n) => <li key={n}><BasisBadge basis="observed" /> {f.describe}{f.verify ? ` · ${f.verify}` : ""}</li>)}</ul>}
      {d.auto_fix !== "on" && <p className="muted small">{d.auto_fix === "plan" ? t("autoPlan") : t("autoOff")}</p>}
    </>
  );
}
