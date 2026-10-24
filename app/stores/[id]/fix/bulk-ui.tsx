"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { UndoButton } from "./autofix-ui";

async function call(url: string, init?: { method: "POST"; body: unknown }) {
  const res = await fetch(url, init ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) } : undefined);
  return { ok: res.ok, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

type Item = { finding_key: string; title: string; type: string; ready: boolean; reason: string | null; describe: string };
type Applied = { finding_key?: string; line?: number; status: string; error: string | null; describe?: string };

// Bulk apply (G8): pick several auto / one-click fixes, see each change, approve once, undo all at once.
export function BulkApply({ storeId }: { storeId: string }) {
  const t = useTranslations("bulk");
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [max, setMax] = useState(50);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ batchId: string; results: Applied[] } | null>(null);

  async function load() {
    setBusy(true); setError(null);
    const r = await call(`/api/stores/${storeId}/fixes/bulk`);
    setBusy(false);
    if (!r.ok) return setError(String(r.body.error ?? t("failed")));
    const list = (r.body.items as Item[]) ?? [];
    setItems(list); setMax(Number(r.body.max ?? 50));
    setPicked(new Set(list.filter((i) => i.ready).slice(0, Number(r.body.max ?? 50)).map((i) => i.finding_key)));
  }
  async function apply() {
    setBusy(true); setError(null);
    const r = await call(`/api/stores/${storeId}/fixes/bulk`, { method: "POST", body: { finding_keys: [...picked], confirm: true } });
    setBusy(false);
    if (!r.ok) return setError(String(r.body.error ?? t("failed")));
    setDone(r.body as unknown as { batchId: string; results: Applied[] });
    router.refresh();
  }

  return (
    <details className="card">
      <summary><strong>{t("bulkTitle")}</strong></summary>
      <p className="muted small">{t("bulkSub", { max })}</p>
      {!items && <button type="button" className="secondary" disabled={busy} onClick={load}>{busy ? t("loading") : t("load")}</button>}
      {items && items.length === 0 && <p className="muted">{t("none")}</p>}
      {items && items.length > 0 && !done && (
        <>
          <ul className="plain">
            {items.map((i) => (
              <li key={i.finding_key}>
                <label>
                  <input type="checkbox" disabled={!i.ready} checked={picked.has(i.finding_key)} onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked && next.size < max) next.add(i.finding_key); else next.delete(i.finding_key);
                    setPicked(next);
                  }} />{" "}
                  <strong>{i.title}</strong> · {i.describe}
                  {!i.ready && <span className="muted small"> · {i.reason}</span>}
                </label>
              </li>
            ))}
          </ul>
          <label className="small"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> {t("confirm", { n: picked.size })}</label>
          <div><button type="button" disabled={busy || !confirm || picked.size === 0} onClick={apply}>{busy ? t("applying") : t("apply", { n: picked.size })}</button></div>
        </>
      )}
      {done && <Results storeId={storeId} done={done} />}
      {error && <p className="error">{error}</p>}
    </details>
  );
}

type PreviewRow = { line: number; productId: number | null; name: string | null; status: "ok" | "same" | "error"; reason: string | null; changes: { field: string; before: string; after: string }[] };

// CSV import (G8): GTIN, SKU and weight for many products; preview line by line, approve once, undo all.
export function CsvImport({ storeId, canWrite }: { storeId: string; canWrite: boolean }) {
  const t = useTranslations("bulk");
  const router = useRouter();
  const [csv, setCsv] = useState<string>("");
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; hash: string; ready: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ batchId: string; results: Applied[] } | null>(null);

  async function runPreview(text: string) {
    setBusy(true); setError(null); setPreview(null); setDone(null); setConfirm(false);
    const r = await call(`/api/stores/${storeId}/fixes/import`, { method: "POST", body: { csv: text, action: "preview" } });
    setBusy(false);
    if (!r.ok) return setError(String(r.body.error ?? t("failed")));
    setPreview(r.body as unknown as { rows: PreviewRow[]; hash: string; ready: number });
  }
  async function apply() {
    if (!preview) return;
    setBusy(true); setError(null);
    const r = await call(`/api/stores/${storeId}/fixes/import`, { method: "POST", body: { csv, action: "apply", hash: preview.hash, confirm: true } });
    setBusy(false);
    if (!r.ok) return setError(String(r.body.error ?? t("failed")));
    setDone(r.body as unknown as { batchId: string; results: Applied[] });
    setPreview(null);
    router.refresh();
  }
  const statusLabel = { ok: t("rowOk"), same: t("rowSame"), error: t("rowError") };

  return (
    <details className="card">
      <summary><strong>{t("csvTitle")}</strong></summary>
      <p className="muted small">{t("csvSub")}</p>
      <pre dir="ltr" className="small">product_id,gtin,sku,weight{"\n"}173,4006381333931,MIR-173,1.2</pre>
      {!canWrite && <p className="muted">{t("needWrite")}</p>}
      <input type="file" accept=".csv,text/csv" disabled={busy} onChange={async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const text = await file.text();
        setCsv(text);
        await runPreview(text);
      }} />
      {busy && <p className="muted">{t("loading")}</p>}
      {preview && (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t("line")}</th><th>{t("product")}</th><th>{t("changes")}</th><th>{t("status")}</th></tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line}>
                    <td className="num">{r.line}</td>
                    <td>{r.productId ? `#${r.productId}` : "—"} {r.name}</td>
                    <td dir="ltr" className="small">{r.changes.map((c) => <div key={c.field}>{c.field}: {c.before || "(empty)"} → <strong>{c.after}</strong></div>)}</td>
                    <td className={r.status === "error" ? "error small" : "small"}>{statusLabel[r.status]}{r.reason ? ` · ${r.reason}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.ready > 0 && canWrite && (
            <>
              <label className="small"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> {t("csvConfirm", { n: preview.ready })}</label>
              <div><button type="button" disabled={busy || !confirm} onClick={apply}>{busy ? t("applying") : t("csvApply", { n: preview.ready })}</button></div>
            </>
          )}
        </>
      )}
      {done && <Results storeId={storeId} done={done} />}
      {error && <p className="error">{error}</p>}
    </details>
  );
}

function Results({ storeId, done }: { storeId: string; done: { batchId: string; results: Applied[] } }) {
  const t = useTranslations("bulk");
  const ok = done.results.filter((r) => r.status === "applied").length;
  return (
    <div>
      <p className="notice">{t("doneLine", { ok, failed: done.results.length - ok })} {ok > 0 && <UndoButton storeId={storeId} batchId={done.batchId} label={t("undoAll")} />}</p>
      <ul className="small">
        {done.results.filter((r) => r.status !== "applied").map((r, i) => <li key={i} className="error">{r.finding_key ?? `line ${r.line}`}: {r.error}</li>)}
      </ul>
    </div>
  );
}
