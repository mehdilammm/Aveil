import { getTranslations } from "next-intl/server";
import type { SupabaseClient } from "@supabase/supabase-js";

const DAYS = 30;

// Per bot: hits whose IP was checked against the operator's list (Observed), user-agent-only claims (Heuristic),
// and hits still waiting for the check. Counts only what the plugin saw: cached pages are not seen.
export async function BotIdentity({ supabase, storeId }: { supabase: SupabaseClient; storeId: string }) {
  const t = await getTranslations("botIdentity");
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const rows: { bot: string; verified: boolean | null }[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data } = await supabase.from("bot_hits").select("bot, verified").eq("store_id", storeId).gte("seen_at", since).range(from, from + 999);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  const by = new Map<string, { verified: number; claim: number; pending: number }>();
  for (const r of rows) {
    const e = by.get(r.bot) ?? { verified: 0, claim: 0, pending: 0 };
    if (r.verified === true) e.verified++;
    else if (r.verified === false) e.claim++;
    else e.pending++;
    by.set(r.bot, e);
  }
  return (
    <>
      <h2>{t("title")}</h2>
      <div className="card">
        {rows.length === 0 ? (
          <p><span className="badge basis-unavailable">{t("unavailable")}</span> {t("none")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t("bot")}</th><th className="num">{t("verified")}</th><th className="num">{t("claim")}</th><th className="num">{t("pending")}</th></tr></thead>
              <tbody>
                {[...by.entries()].sort((a, b) => b[1].verified + b[1].claim - (a[1].verified + a[1].claim)).map(([bot, v]) => (
                  <tr key={bot}><td>{bot}</td><td className="num">{v.verified}</td><td className="num">{v.claim}</td><td className="num">{v.pending}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small"><span className="badge basis-observed">{t("observed")}</span> {t("observedNote")} <span className="badge basis-heuristic">{t("heuristic")}</span> {t("heuristicNote")}</p>
        <p className="muted small">{t("minimum", { days: DAYS })}</p>
      </div>
    </>
  );
}
