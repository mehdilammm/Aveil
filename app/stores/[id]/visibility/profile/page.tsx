import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations, getLocale } from "next-intl/server";
import { BasisBadge, formatDate } from "@/components/badges";
import { VisibilityTabs } from "@/components/visibility-tabs";
import { getStore } from "@/lib/data";
import { summarizeProfiles, type AnswerProfile, type BrandSummary } from "@/lib/profile";
import { getUser } from "@/lib/supabase/server";

export async function generateMetadata() {
  return { title: (await getTranslations("visibilityPage"))("tabProfile") };
}

function SentimentLine({ s }: { s: BrandSummary }) {
  const tv = useTranslations("visibilityPage");
  const parts = (["positive", "neutral", "negative", "unclassified"] as const).filter((k) => s.sentiment[k] > 0).map((k) => `${tv(`tone_${k}`)} ${s.sentiment[k]}`);
  return <span className="small">{parts.join(" · ") || "—"}</span>;
}

function Brand({ s, total }: { s: BrandSummary; total: number }) {
  const tv = useTranslations("visibilityPage");
  return (
    <div className="card finding">
      <h3>{s.name}</h3>
      <p className="small">
        <BasisBadge basis="observed" /> {tv("pNamed", { n: s.questions, of: total })} · {tv("pTone")} <SentimentLine s={s} />
      </p>
      {s.features.length > 0 && (
        <p className="small"><strong>{tv("pSay")}</strong> {s.features.slice(0, 10).map((f) => `${f.text}${f.count > 1 ? ` (×${f.count})` : ""}`).join(", ")}</p>
      )}
      {s.descriptions.length > 0 && (
        <details>
          <summary className="muted small">{tv("pHow", { n: s.descriptions.length })}</summary>
          <ul className="small">
            {s.descriptions.map((d, i) => (
              <li key={i}>&ldquo;{d.text}&rdquo; <span className="muted">— {tv("pAnswerTo", { prompt: d.prompt })}</span></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default async function BrandProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const { id } = await params;
  const { supabase } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const tv = await getTranslations("visibilityPage");

  const { data: runs } = await supabase.from("visibility_runs").select("id, created_at").eq("store_id", id).eq("status", "complete").order("created_at", { ascending: false }).limit(1);
  const run = runs?.[0];
  const { data: rows } = run
    ? await supabase.from("visibility_results").select("prompt, mentioned, competitors, profile").eq("run_id", run.id).eq("engine", "gemini").not("answer", "is", null)
    : { data: [] };
  const summary = summarizeProfiles(store.name, (rows ?? []).map((r) => ({ prompt: r.prompt, mentioned: r.mentioned, competitors: (r.competitors as string[]) ?? [], profile: r.profile as AnswerProfile | null })));

  return (
    <>
      <div className="page-head">
        <h1>{tv("tabProfile")}</h1>
        <p className="sub">{tv("pSub")}</p>
      </div>
      <VisibilityTabs storeId={id} active="/profile" />
      <div className="card">
        <p className="muted small">
          {tv("pNote", { date: run ? formatDate(run.created_at, locale) : "—" })}
          {summary.answers > 0 && ` ${tv("pProfiled", { n: summary.profiled, of: summary.answers })}`}
        </p>
      </div>
      {!run || summary.answers === 0 ? (
        <div className="card empty"><strong>{tv("noAnswersTitle")}</strong><p>{tv("runFirst")}</p></div>
      ) : (
        <>
          <h2>{tv("yourStoreCap")}</h2>
          {summary.store.questions === 0 ? (
            <div className="card"><p className="small"><BasisBadge basis="observed" /> {tv("pNotNamed", { n: summary.answers })}</p></div>
          ) : (
            <Brand s={summary.store} total={summary.answers} />
          )}
          <h2>{tv("pInstead", { n: summary.competitors.length })}</h2>
          {summary.competitors.length === 0 ? <p className="muted">{tv("pNoOther")}</p> : summary.competitors.map((c) => <Brand key={c.name} s={c} total={summary.answers} />)}
        </>
      )}
    </>
  );
}
