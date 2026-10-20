"use client";

import { useActionState } from "react";
import { logIn, signUp, type AuthState } from "./actions";

export function AuthForm() {
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
      {state.error && <p className="error">{state.error}</p>}
      {state.notice && <p className="notice">{state.notice}</p>}
      <div className="row">
        <button formAction={loginAction} disabled={busy}>Log in</button>
        <button formAction={signupAction} className="secondary" disabled={busy}>Sign up</button>
      </div>
    </form>
  );
}
