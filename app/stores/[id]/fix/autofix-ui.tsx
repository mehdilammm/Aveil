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

// G4: image alt text, its own opt-in inside auto-fix (writes with the write key, empty alt text only).
export function AltTextToggle({ storeId, enabled, canWrite }: { storeId: string; enabled: boolean; canWrite: boolean }) {
  const t = useTranslations("autofix");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = async (on: boolean) => {
    if (on && !window.confirm(t("altConfirm"))) return;
    setBusy(true);
    setError(null);
    const r = await post(`/api/stores/${storeId}/autofix`, on ? { action: "alt_on", confirm: true } : { action: "alt_off" });
    setBusy(false);
    if (!r.ok) return setError(String(r.body.error ?? t("failed")));
    if (on) setDone(t("altEnabledNow", { n: ((r.body.results ?? []) as { status: string }[]).filter((x) => x.status === "applied").length }));
    router.refresh();
  };
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong className="small">{t("altTitle")}</strong>
        <span className={`badge ${enabled ? "state-resolved" : "basis-unavailable"}`}>{enabled ? t("on") : t("off")}</span>
      </div>
      <p className="muted small">{t("altIntro")}</p>
      {!canWrite ? <p className="muted small">{t("altNeedsWrite")}</p> : enabled ? (
        <div><button className="secondary" onClick={() => set(false)} disabled={busy}>{t("turnOff")}</button></div>
      ) : (
        <div><button onClick={() => set(true)} disabled={busy}>{busy ? t("applying") : t("altTurnOn")}</button></div>
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
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="ck_…" aria-label={t("consumerKey")} autoComplete="off" />
        <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="cs_…" aria-label={t("consumerSecret")} type="password" autoComplete="off" />
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

type ReturnsPreview = { proposal: { category: string; countries: string[]; days?: number; method?: string; fees?: string; link?: string } | null; basis: string[]; unclear: string | null; page: string | null; hash: string | null };

// G7: the return policy AgentScope proposes from the returns page, with the exact sentences it is based on; one
// confirmation adds it to all products. When the page is unclear, a short form takes the merchant's answer.
export function ReturnsFix({ storeId, findingKey }: { storeId: string; findingKey: string }) {
  const t = useTranslations("autofix");
  const router = useRouter();
  const [preview, setPreview] = useState<ReturnsPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({ category: "MerchantReturnFiniteReturnWindow", days: "", countries: "", method: "", fees: "" });
  const url = `/api/stores/${storeId}/fixes`;
  const done = (r: { ok: boolean; body: Record<string, unknown> }) => {
    setMsg(r.ok ? { ok: true, text: `${String(r.body.describe ?? "")}${r.body.verify === "resolved" ? ` · ${t("verified")}` : ""}` } : { ok: false, text: String(r.body.error ?? t("failed")) });
    if (r.ok) router.refresh();
  };
  const show = async () => {
    setBusy(true);
    const r = await post(url, { finding_key: findingKey, preview: true });
    setBusy(false);
    if (r.ok) setPreview(r.body as unknown as ReturnsPreview);
    else setMsg({ ok: false, text: String(r.body.error ?? t("failed")) });
  };
  const apply = async () => {
    if (!preview?.hash || !window.confirm(t("confirm_returns"))) return;
    setBusy(true);
    done(await post(url, { finding_key: findingKey, confirm: true, proposal_hash: preview.hash }));
    setBusy(false);
  };
  const answer = async () => {
    setBusy(true);
    const a = { category: form.category, countries: form.countries.split(/[\s,]+/).filter(Boolean), ...(form.days ? { days: Number(form.days) } : {}), ...(form.method ? { method: form.method } : {}), ...(form.fees ? { fees: form.fees } : {}), ...(preview?.page ? { link: preview.page } : {}) };
    done(await post(url, { finding_key: findingKey, answer: JSON.stringify(a) }));
    setBusy(false);
  };
  const p = preview?.proposal;
  return (
    <div className="stack small" style={{ marginTop: 6 }}>
      <span><span className="badge basis-heuristic">{t("chipOneClick")}</span> <span className="muted">{t("explain_returns")}</span></span>
      {!preview && <div><button className="secondary" onClick={show} disabled={busy}>{busy ? t("applying") : t("ret_show")}</button></div>}
      {p && (
        <>
          <p><strong>{t(`ret_${p.category}`, { days: p.days ?? 0, countries: p.countries.join(", ") })}</strong>{p.fees ? ` · ${t(`ret_fees_${p.fees}`)}` : ""}{p.method ? ` · ${t(`ret_method_${p.method}`)}` : ""}</p>
          <p className="muted">{t("ret_based_on")} {preview?.page && <a href={preview.page} target="_blank" rel="noopener noreferrer">{preview.page}</a>}</p>
          <ul>{preview!.basis.map((s, i) => <li key={i}><q>{s}</q></li>)}</ul>
          <div><button className="secondary" onClick={apply} disabled={busy}>{busy ? t("applying") : t("do_returns")}</button></div>
        </>
      )}
      {preview && !p && (
        <>
          <p><span className="badge basis-unavailable">{t("ret_unclear")}</span> {preview.unclear}</p>
          {preview.basis.length > 0 && <ul>{preview.basis.map((s, i) => <li key={i}><q>{s}</q></li>)}</ul>}
          <div className="row">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} aria-label={t("ret_q_category")}>
              {["MerchantReturnFiniteReturnWindow", "MerchantReturnNotPermitted", "MerchantReturnUnlimitedWindow"].map((c) => <option key={c} value={c}>{t(`ret_opt_${c}`)}</option>)}
            </select>
            {form.category === "MerchantReturnFiniteReturnWindow" && <input value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} placeholder={t("ret_q_days")} aria-label={t("ret_q_days")} inputMode="numeric" style={{ maxWidth: 120 }} />}
            <input value={form.countries} onChange={(e) => setForm({ ...form, countries: e.target.value })} placeholder={t("ret_q_countries")} aria-label={t("ret_q_countries")} dir="ltr" style={{ maxWidth: 200 }} />
            {form.category !== "MerchantReturnNotPermitted" && (
              <>
                <select value={form.fees} onChange={(e) => setForm({ ...form, fees: e.target.value })} aria-label={t("ret_q_fees")}>
                  <option value="">{t("ret_not_stated")}</option>
                  <option value="FreeReturn">{t("ret_fees_FreeReturn")}</option>
                  <option value="ReturnFeesCustomerResponsibility">{t("ret_fees_ReturnFeesCustomerResponsibility")}</option>
                </select>
                <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} aria-label={t("ret_q_method")}>
                  <option value="">{t("ret_not_stated")}</option>
                  <option value="ReturnByMail">{t("ret_method_ReturnByMail")}</option>
                  <option value="ReturnInStore">{t("ret_method_ReturnInStore")}</option>
                </select>
              </>
            )}
            <button className="secondary" onClick={answer} disabled={busy || !form.countries.trim()}>{busy ? t("applying") : t("save")}</button>
          </div>
        </>
      )}
      {msg && <span className={msg.ok ? "status-connected" : "error"}>{msg.text}</span>}
    </div>
  );
}
