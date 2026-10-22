"use client";

import { useActionState } from "react";
import { BasisBadge } from "@/components/badges";
import { QUESTION_LANGUAGES } from "@/lib/question-suggest";
import { addPrompts, suggest, type PromptState } from "./actions";

export function PromptsForm({ storeId, remaining, existing }: { storeId: string; remaining: number; existing: string[] }) {
  const [addState, addAction, adding] = useActionState<PromptState, FormData>(addPrompts, {});
  const [sugState, sugAction, suggesting] = useActionState<PromptState, FormData>(suggest, {});
  const known = new Set(existing.map((e) => e.toLowerCase()));
  const suggestions = (sugState.suggestions ?? []).filter((s) => !known.has(s.toLowerCase()));

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <form action={addAction} className="stack">
        <input type="hidden" name="store_id" value={storeId} />
        <label>
          Add a question <small className="hint">{remaining} of 15 left</small>
          <input name="prompt" maxLength={300} placeholder="best argan oil shop in Morocco" disabled={remaining === 0} />
        </label>
        {suggestions.length > 0 && (
          <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, display: "grid", gap: 6 }}>
            <legend className="muted small">Suggestions. Tick the ones to keep and edit them before saving.</legend>
            {sugState.source && <p className="muted small">{sugState.basis && <BasisBadge basis={sugState.basis} />} {sugState.source}</p>}
            {suggestions.map((s, i) => (
              <div key={`${i}-${s}`} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" name="pick" value={i} aria-label="Keep this question" />
                <input name={`text_${i}`} defaultValue={s} maxLength={300} dir="auto" style={{ flex: 1 }} />
              </div>
            ))}
          </fieldset>
        )}
        {(addState.error || sugState.error) && <p className="error">{addState.error ?? sugState.error}</p>}
        <div className="row">
          <button disabled={adding || remaining === 0}>{adding ? "Saving…" : "Save"}</button>
        </div>
      </form>
      <form action={sugAction} className="row" style={{ gap: 8 }}>
        <input type="hidden" name="store_id" value={storeId} />
        <select name="language" defaultValue="en" aria-label="Language of the questions">
          {Object.entries(QUESTION_LANGUAGES).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
        <button className="secondary" disabled={suggesting || remaining === 0}>{suggesting ? "Reading your products…" : "Suggest questions from my products"}</button>
      </form>
    </div>
  );
}
