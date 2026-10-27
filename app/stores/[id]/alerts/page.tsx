import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BasisBadge, formatDate } from "@/components/badges";
import { PlanLock } from "@/components/plan-lock";
import type { BreakageDetail } from "@/lib/breakage";
import { getStore } from "@/lib/data";
import { storePlan } from "@/lib/plan-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { canEdit, storeAccess } from "@/lib/workspace";
import { DismissButton } from "./dismiss-button";

export const dynamic = "force-dynamic";

type Alert = { id: string; kind: "breakage" | "product_check"; status: string; title: string; detail: Record<string, unknown>; created_at: string };
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

  return (
    <>
      <div className="page-head">
        <h1>{t("title")}</h1>
        <p className="sub">{t("sub")}</p>
      </div>
      <p className="muted small">{t("note")}</p>
      {!plan.breakageAlerts && <PlanLock feature="breakageAlerts" />}
      {alerts.length === 0 && <div className="card empty"><p>{t("none")}</p></div>}
      {alerts.map((a) => (
        <div key={a.id} className={`card${a.status === "open" ? "" : " finding-resolved"}`}>
          {a.kind === "breakage" ? <Breakage d={a.detail as unknown as BreakageDetail} t={t} /> : <ProductCheck d={a.detail as unknown as ProductDetail} t={t} />}
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
