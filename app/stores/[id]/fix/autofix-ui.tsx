"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { FixKind, FixType, InputField } from "@/lib/fix-catalog";

type PlanRow = { finding_key: string; title: string; kind: string; ready: boolean; reason: string | null; describe: string };

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

// The "Auto-fix technical issues" setting: off by default; the first time, a preview of everything it will
// change and one approval.
export function AutoFixPanel({ storeId, enabled, approvedAt }: { storeId: string; enabled: boolean; approvedAt: string | null }) {
  const t = useTranslations("autofix");
  const router = useRouter();
  const [plan, setPlan] = useState<PlanRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const base = `/api/stores/${storeId}/autofix`;
  const preview = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch(base).then((r) => r.json()).catch(() => ({ error: t("failed") }));
    setBusy(false);
    if (res.error) setError(res.error);
    else setPlan(res.plan);
  };
  const enable = async () => {
    setBusy(true);
    const r = await post(base, { action: "enable", confirm: true });
    setBusy(false);
    if (!r.ok) return setError(String(r.body.error ?? t("failed")));
    const results = (r.body.results ?? []) as { status: string }[];
    setDone(t("enabledNow", { n: results.filter((x) => x.status === "applied").length }));
    setPlan(null);
    router.refresh();
  };
  const disable = async () => {
    setBusy(true);
    await post(base, { action: "disable" });
    setBusy(false);
    router.refresh();
  };
  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{t("title")}</strong>
        <span className={`badge ${enabled ? "state-resolved" : "basis-unavailable"}`}>{enabled ? t("on") : t("off")}</span>
      </div>
      <p className="muted small">{t("intro")}</p>
      {enabled ? (
        <div className="row small">
          <span className="muted">{approvedAt ? t("approvedAt", { date: approvedAt.slice(0, 10) }) : ""}</span>
          <button className="secondary" onClick={disable} disabled={busy}>{t("turnOff")}</button>
        </div>
      ) : plan ? (
        <>
          <p className="small"><strong>{t("previewTitle")}</strong></p>
          {plan.length === 0 ? <p className="small">{t("nothing")}</p> : (
            <ul className="small">
              {plan.map((p) => <li key={p.finding_key}>{p.describe} {p.ready ? "" : <span className="muted">({t("notReady")}: {p.reason})</span>}</li>)}
            </ul>
          )}
          <p className="muted small">{t("previewNote")}</p>
          <div className="row">
            <button onClick={enable} disabled={busy}>{busy ? t("applying") : t("approve")}</button>
            <button className="secondary" onClick={() => setPlan(null)} disabled={busy}>{t("cancel")}</button>
          </div>
        </>
      ) : (
        <div><button onClick={preview} disabled={busy}>{busy ? t("loading") : t("turnOn")}</button></div>
      )}
      {done && <p className="small status-connected">{done}</p>}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

export function UndoButton({ storeId, auditId, batchId, label }: { storeId: string; auditId?: string; batchId?: string; label?: string }) {
  const t = useTranslations("autofix");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button type="button" className="linklike" disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await post(`/api/stores/${storeId}/fixes/undo`, auditId ? { audit_id: auditId } : { batch_id: batchId });
        setBusy(false);
        if (!r.ok) setError(String(r.body.error ?? ((r.body.results as { error?: string }[] | undefined)?.find((x) => x.error)?.error ?? t("failed"))));
        router.refresh();
      }}>{busy ? t("undoing") : label ?? t("undo")}</button>
      {error && <span className="error small"> {error}</span>}
    </span>
  );
}

// One-click (explanation + confirmation) and input (one short question) fixes on a finding.
export function FixAction({ storeId, findingKey, type, kind, field, canWrite }: { storeId: string; findingKey: string; type: FixType; kind: FixKind; field?: InputField; canWrite: boolean }) {
  const t = useTranslations("autofix");
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (type === "guide") return null;
  if (type === "auto") return <p className="small"><span className="badge basis-observed">{t("chipAuto")}</span> <span className="muted">{t("autoNote")}</span></p>;
  const run = async () => {
    if (type === "one_click" && !window.confirm(t(`confirm_${kind}`))) return;
    setBusy(true);
    const r = await post(`/api/stores/${storeId}/fixes`, { finding_key: findingKey, confirm: type === "one_click", value: type === "input" ? value : undefined });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: `${String(r.body.describe ?? "")}${r.body.verify === "resolved" ? ` · ${t("verified")}` : r.body.verify ? ` · ${t(`v_${r.body.verify}`)}` : ""}` } : { ok: false, text: String(r.body.error ?? t("failed")) });
    if (r.ok) router.refresh();
  };
  return (
    <div className="stack small" style={{ marginTop: 6 }}>
      <span><span className="badge basis-heuristic">{t(type === "one_click" ? "chipOneClick" : "chipInput")}</span> <span className="muted">{t(`explain_${kind}`)}</span></span>
      {!canWrite ? <span className="muted">{t("needWriteKey")}</span> : (
        <div className="row">
          {type === "input" && <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={t(`ph_${field}`)} aria-label={t(`ph_${field}`)} dir="ltr" style={{ maxWidth: 320 }} />}
          <button className="secondary" onClick={run} disabled={busy || (type === "input" && !value.trim())}>{busy ? t("applying") : t(type === "one_click" ? `do_${kind}` : "save")}</button>
        </div>
      )}
      {msg && <span className={msg.ok ? "status-connected" : "error"}>{msg.text}</span>}
    </div>
  );
}

export function WriteKeyForm({ storeId, hint }: { storeId: string; hint: string | null }) {
  const t = useTranslations("autofix");
  const router = useRouter();
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <details className="card">
      <summary className="small">{hint ? t("writeKeySaved", { hint }) : t("writeKeyAdd")}</summary>
      <p className="muted small">{t("writeKeyIntro")}</p>
      <div className="row small" style={{ flexWrap: "wrap" }}>
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="ck_…" aria-label="Consumer key" autoComplete="off" />
        <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="cs_…" aria-label="Consumer secret" type="password" autoComplete="off" />
        <button className="secondary" disabled={busy || !key || !secret} onClick={async () => {
          setBusy(true);
          const r = await post(`/api/stores/${storeId}/write-key`, { consumer_key: key, consumer_secret: secret });
          setBusy(false);
          setMsg(r.ok ? { ok: true, text: t("writeKeyOk") } : { ok: false, text: String(r.body.error ?? t("failed")) });
          if (r.ok) {
            setKey("");
            setSecret("");
            router.refresh();
          }
        }}>{busy ? t("checking") : t("writeKeySave")}</button>
      </div>
      {msg && <p className={`small ${msg.ok ? "status-connected" : "error"}`}>{msg.text}</p>}
    </details>
  );
}
