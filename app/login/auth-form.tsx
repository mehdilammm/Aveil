"use client";

import Link from "next/link";
import { useActionState } from "react";
import { logIn, signUp, type AuthState } from "./actions";

export function AuthForm({ signup = false }: { signup?: boolean }) {
  const [loginState, loginAction, loggingIn] = useActionState<AuthState, FormData>(logIn, {});
  const [signupState, signupAction, signingUp] = useActionState<AuthState, FormData>(signUp, {});
  const state = signupState.error || signupState.notice ? signupState : loginState;
  const busy = loggingIn || signingUp;

  return (
    <form className="stack card">
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" minLength={8} required />
      </label>
      <label className="agree">
        <input type="checkbox" name="agree" value="yes" defaultChecked={false} />
        <span>I agree to the <Link href="/terms" target="_blank">Terms</Link> and the <Link href="/privacy" target="_blank">Privacy Policy</Link> (needed to sign up).</span>
      </label>
      {state.error && <p className="error">{state.error}</p>}
      {state.notice && <p className="notice">{state.notice}</p>}
      <div className="row">
        <button formAction={signup ? signupAction : loginAction} disabled={busy}>{signup ? "Sign up" : "Log in"}</button>
        <button formAction={signup ? loginAction : signupAction} className="secondary" disabled={busy}>{signup ? "Log in" : "Sign up"}</button>
      </div>
    </form>
  );
}
