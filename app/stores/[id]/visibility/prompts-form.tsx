"use client";

import { useActionState } from "react";
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
          <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
            <legend className="muted small">Suggestions from your categories. Tick the ones to keep.</legend>
            {suggestions.map((s) => (
              <label key={s} style={{ display: "flex", gap: 8, fontWeight: 400 }}>
                <input type="checkbox" name="accept" value={s} /> {s}
              </label>
            ))}
          </fieldset>
        )}
        {(addState.error || sugState.error) && <p className="error">{addState.error ?? sugState.error}</p>}
        <div className="row">
          <button disabled={adding || remaining === 0}>{adding ? "Saving…" : "Save"}</button>
        </div>
      </form>
      <form action={sugAction}>
        <input type="hidden" name="store_id" value={storeId} />
        <button className="secondary" disabled={suggesting || remaining === 0}>{suggesting ? "Reading categories…" : "Suggest 5 questions"}</button>
      </form>
    </div>
  );
}
