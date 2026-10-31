"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { logIn, signUp, type AuthState } from "./actions";

export function AuthForm({ signup = false }: { signup?: boolean }) {
  const [loginState, loginAction, loggingIn] = useActionState<AuthState, FormData>(logIn, {});
  const [signupState, signupAction, signingUp] = useActionState<AuthState, FormData>(signUp, {});
  const state = signupState.error || signupState.notice ? signupState : loginState;
  const busy = loggingIn || signingUp;
  const t = useTranslations("login");

  return (
    <form className="stack card">
      <label>
        {t("email")}
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        {t("password")}
        <input name="password" type="password" autoComplete="current-password" minLength={8} required />
      </label>
      <label className="agree">
        <input type="checkbox" name="agree" value="yes" defaultChecked={false} />
        <span>{t("agreePre")} <Link href="/terms" target="_blank">{t("terms")}</Link> {t("agreeMid")} <Link href="/privacy" target="_blank">{t("privacy")}</Link> {t("agreePost")}</span>
      </label>
      {state.error && <p className="error">{state.error}</p>}
      {state.notice && <p className="notice">{state.notice}</p>}
      <div className="row">
        <button formAction={signup ? signupAction : loginAction} disabled={busy}>{signup ? t("signup") : t("login")}</button>
        <button formAction={signup ? loginAction : signupAction} className="secondary" disabled={busy}>{signup ? t("login") : t("signup")}</button>
      </div>
    </form>
  );
}
