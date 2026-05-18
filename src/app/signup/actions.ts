"use server";

import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

export interface SignupFormState {
  status: "idle" | "error";
  message: string;
  fieldErrors: Partial<Record<"loginId" | "email" | "password", string>>;
}

function getText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function signupAction(_previousState: SignupFormState, formData: FormData): Promise<SignupFormState> {
  const loginId = getText(formData, "loginId");
  const email = normalizeEmail(getText(formData, "email"));
  const displayName = getText(formData, "displayName");
  const password = getText(formData, "password");
  const fieldErrors: SignupFormState["fieldErrors"] = {};

  if (!/^[a-zA-Z0-9_]{3,24}$/.test(loginId)) {
    fieldErrors.loginId = "아이디는 영문, 숫자, 밑줄 3-24자로 입력해주세요.";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = "이메일 형식이 올바르지 않습니다.";
  }

  if (password.length < 8) {
    fieldErrors.password = "비밀번호는 8자 이상이어야 합니다.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "입력값을 확인해주세요.",
      fieldErrors,
    };
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ loginId }, { email }],
    },
    select: {
      loginId: true,
      email: true,
    },
  });

  if (existingUser) {
    return {
      status: "error",
      message: "이미 사용 중인 계정 정보입니다.",
      fieldErrors: {
        loginId: existingUser.loginId === loginId ? "이미 사용 중인 아이디입니다." : undefined,
        email: existingUser.email === email ? "이미 사용 중인 이메일입니다." : undefined,
      },
    };
  }

  const user = await prisma.user.create({
    data: {
      loginId,
      email,
      displayName: displayName || loginId,
      passwordHash: await hashPassword(password),
      role: "USER",
    },
    select: {
      id: true,
    },
  });

  await createSession(user.id);
  redirect("/");
}
