"use server";

import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

export interface LoginFormState {
  status: "idle" | "error";
  message: string;
}

function getText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function loginAction(_previousState: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const loginId = getText(formData, "loginId");
  const password = getText(formData, "password");

  if (!loginId || !password) {
    return {
      status: "error",
      message: "아이디와 비밀번호를 입력해주세요.",
    };
  }

  const user = await prisma.user.findUnique({
    where: { loginId },
    select: {
      id: true,
      passwordHash: true,
    },
  });

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return {
      status: "error",
      message: "아이디 또는 비밀번호가 올바르지 않습니다.",
    };
  }

  await createSession(user.id);
  redirect("/");
}
