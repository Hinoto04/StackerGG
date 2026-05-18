"use client";

import { useActionState } from "react";
import { requestPasswordResetAction, type ResetRequestState } from "./actions";

const initialState: ResetRequestState = {
  status: "idle",
  message: "",
};

export function ResetRequestForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);

  return (
    <form className="auth-panel" action={formAction}>
      {state.message ? (
        <div className={`form-alert ${state.status === "success" ? "success-alert" : "error-alert"}`} role="status">
          <strong>{state.status === "success" ? "요청 완료" : "요청 실패"}</strong>
          <span>{state.message}</span>
        </div>
      ) : null}

      <label className="field">
        <span>이메일</span>
        <input autoComplete="email" name="email" required type="email" />
      </label>

      <button className="button primary-button" disabled={pending} type="submit">
        {pending ? "전송 중" : "재설정 메일 보내기"}
      </button>
    </form>
  );
}
