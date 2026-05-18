"use server";

import { createRawToken, hashOpaqueToken } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/email";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

export interface ResetRequestState {
  status: "idle" | "success" | "error";
  message: string;
}

export interface ResetConfirmState {
  status: "idle" | "success" | "error";
  message: string;
}

function getText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function getResetExpiresAt() {
  return new Date(Date.now() + 1000 * 60 * 60);
}

export async function requestPasswordResetAction(_previousState: ResetRequestState, formData: FormData): Promise<ResetRequestState> {
  const email = normalizeEmail(getText(formData, "email"));
  const successMessage = "계정이 존재한다면 비밀번호 재설정 메일을 보냈습니다.";

  if (!email) {
    return {
      status: "error",
      message: "이메일을 입력해주세요.",
    };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
    },
  });

  if (!user) {
    return {
      status: "success",
      message: successMessage,
    };
  }

  const token = createRawToken();

  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({
      where: {
        userId: user.id,
      },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashOpaqueToken(token),
        expiresAt: getResetExpiresAt(),
      },
    }),
  ]);

  await sendPasswordResetEmail({ email: user.email, token });

  return {
    status: "success",
    message: successMessage,
  };
}

export async function confirmPasswordResetAction(_previousState: ResetConfirmState, formData: FormData): Promise<ResetConfirmState> {
  const token = getText(formData, "token");
  const password = getText(formData, "password");

  if (!token || password.length < 8) {
    return {
      status: "error",
      message: "유효한 링크와 8자 이상의 새 비밀번호가 필요합니다.",
    };
  }

  const tokenHash = hashOpaqueToken(token);
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
    },
  });

  if (!resetToken || resetToken.expiresAt.getTime() <= Date.now()) {
    return {
      status: "error",
      message: "비밀번호 재설정 링크가 만료되었거나 올바르지 않습니다.",
    };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: {
        passwordHash: await hashPassword(password),
      },
    }),
    prisma.passwordResetToken.deleteMany({
      where: {
        userId: resetToken.userId,
      },
    }),
    prisma.authSession.deleteMany({
      where: {
        userId: resetToken.userId,
      },
    }),
  ]);

  return {
    status: "success",
    message: "비밀번호를 변경했습니다. 새 비밀번호로 로그인해주세요.",
  };
}
