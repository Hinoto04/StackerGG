"use client";

import { useActionState } from "react";
import { loginAction, type LoginFormState } from "./actions";

const initialState: LoginFormState = {
  status: "idle",
  message: "",
};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form className="auth-panel" action={formAction}>
      {state.message ? (
        <div className="form-alert error-alert" role="status">
          <strong>로그인 실패</strong>
          <span>{state.message}</span>
        </div>
      ) : null}

      <label className="field">
        <span>아이디</span>
        <input autoComplete="username" name="loginId" required type="text" />
      </label>

      <label className="field">
        <span>비밀번호</span>
        <input autoComplete="current-password" name="password" required type="password" />
      </label>

      <button className="button primary-button" disabled={pending} type="submit">
        {pending ? "로그인 중" : "로그인"}
      </button>

      <a className="button ghost-button" href="/auth/google">
        Google로 로그인
      </a>

      <div className="auth-links">
        <a href="/signup">회원가입</a>
        <a href="/password/reset">비밀번호 재설정</a>
      </div>
    </form>
  );
}
