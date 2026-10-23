"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { BasisBadge } from "@/components/badges";
import { MARKETS, type MarketId } from "@/lib/markets";
import { addPrompts, suggest, type PromptState } from "./actions";

export function PromptsForm({ storeId, remaining, limit, existing, defaultMarket }: { storeId: string; remaining: number; limit: number; existing: string[]; defaultMarket: MarketId }) {
  const t = useTranslations("prompts");
  const [market, setMarket] = useState<string>(defaultMarket);
  const [addState, addAction, adding] = useActionState<PromptState, FormData>(addPrompts, {});
  const [sugState, sugAction, suggesting] = useActionState<PromptState, FormData>(suggest, {});
  const known = new Set(existing.map((e) => e.toLowerCase()));
  const suggestions = (sugState.suggestions ?? []).filter((s) => !known.has(s.toLowerCase()));
  // Suggestions belong to the market they were written for.
  const formMarket = suggestions.length && sugState.market ? sugState.market : market;
  const marketSelect = (
    <select value={market} onChange={(e) => setMarket(e.target.value)} aria-label={t("market")}>
      {MARKETS.map((m) => <option key={m.id} value={m.id}>{t(`m_${m.id}`)}</option>)}
    </select>
  );

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <div className="row small">{t("marketLabel")} {marketSelect}</div>
      <form action={addAction} className="stack">
        <input type="hidden" name="store_id" value={storeId} />
        <input type="hidden" name="market" value={formMarket} />
        <label>
          {t("add")} <small className="hint">{t("left", { n: remaining, limit })}</small>
          <input name="prompt" maxLength={300} dir="auto" disabled={remaining === 0} />
        </label>
        {suggestions.length > 0 && (
          <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, display: "grid", gap: 6 }}>
            <legend className="muted small">{t("suggestionsLegend", { market: t(`m_${formMarket}`) })}</legend>
            {sugState.source && <p className="muted small">{sugState.basis && <BasisBadge basis={sugState.basis} />} {sugState.source}</p>}
            {suggestions.map((s, i) => (
              <div key={`${i}-${s}`} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" name="pick" value={i} aria-label={t("keep")} />
                <input name={`text_${i}`} defaultValue={s} maxLength={300} dir="auto" style={{ flex: 1 }} />
              </div>
            ))}
          </fieldset>
        )}
        {(addState.error || sugState.error) && <p className="error">{addState.error ?? sugState.error}</p>}
        <div className="row">
          <button disabled={adding || remaining === 0}>{adding ? t("saving") : t("save")}</button>
        </div>
      </form>
      <form action={sugAction} className="row" style={{ gap: 8 }}>
        <input type="hidden" name="store_id" value={storeId} />
        <input type="hidden" name="market" value={market} />
        <button className="secondary" disabled={suggesting || remaining === 0}>{suggesting ? t("suggesting") : t("suggest")}</button>
        <span className="muted small">{t("nativeNote")}</span>
      </form>
    </div>
  );
}
