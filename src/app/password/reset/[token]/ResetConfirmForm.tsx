"use client";

import { useActionState } from "react";
import { confirmPasswordResetAction, type ResetConfirmState } from "../actions";

const initialState: ResetConfirmState = {
  status: "idle",
  message: "",
};

export function ResetConfirmForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(confirmPasswordResetAction, initialState);

  return (
    <form className="auth-panel" action={formAction}>
      {state.message ? (
        <div className={`form-alert ${state.status === "success" ? "success-alert" : "error-alert"}`} role="status">
          <strong>{state.status === "success" ? "변경 완료" : "변경 실패"}</strong>
          <span>{state.message}</span>
        </div>
      ) : null}

      <input name="token" type="hidden" value={token} />

      <label className="field">
        <span>새 비밀번호</span>
        <input autoComplete="new-password" minLength={8} name="password" required type="password" />
      </label>

      <button className="button primary-button" disabled={pending || state.status === "success"} type="submit">
        {pending ? "변경 중" : "비밀번호 변경"}
      </button>

      {state.status === "success" ? (
        <a className="button ghost-button" href="/login">
          로그인으로
        </a>
      ) : null}
    </form>
  );
}
