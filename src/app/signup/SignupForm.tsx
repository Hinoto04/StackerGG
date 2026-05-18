"use client";

import { useActionState } from "react";
import { signupAction, type SignupFormState } from "./actions";

const initialState: SignupFormState = {
  status: "idle",
  message: "",
  fieldErrors: {},
};

function FieldError({ message }: { message?: string }) {
  return message ? <span className="field-error">{message}</span> : null;
}

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signupAction, initialState);

  return (
    <form className="auth-panel" action={formAction}>
      {state.message ? (
        <div className="form-alert error-alert" role="status">
          <strong>회원가입 실패</strong>
          <span>{state.message}</span>
        </div>
      ) : null}

      <label className="field">
        <span>아이디</span>
        <input autoComplete="username" name="loginId" required type="text" />
        <FieldError message={state.fieldErrors.loginId} />
      </label>

      <label className="field">
        <span>이메일</span>
        <input autoComplete="email" name="email" required type="email" />
        <FieldError message={state.fieldErrors.email} />
      </label>

      <label className="field">
        <span>표시 이름</span>
        <input autoComplete="name" name="displayName" type="text" />
      </label>

      <label className="field">
        <span>비밀번호</span>
        <input autoComplete="new-password" name="password" required type="password" />
        <FieldError message={state.fieldErrors.password} />
      </label>

      <button className="button primary-button" disabled={pending} type="submit">
        {pending ? "가입 중" : "회원가입"}
      </button>
    </form>
  );
}
