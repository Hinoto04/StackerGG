import nodemailer from "nodemailer";

function getBaseUrl() {
  return process.env.AUTH_BASE_URL || "http://localhost:3000";
}

function getSmtpPort() {
  const port = Number(process.env.SMTP_PORT || "587");
  return Number.isFinite(port) ? port : 587;
}

export function createPasswordResetUrl(token: string) {
  return `${getBaseUrl()}/password/reset/${encodeURIComponent(token)}`;
}

export async function sendPasswordResetEmail({ email, token }: { email: string; token: string }) {
  const resetUrl = createPasswordResetUrl(token);
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM;

  if (!host || !from) {
    console.warn(`Password reset email is not configured. Reset URL for ${email}: ${resetUrl}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port: getSmtpPort(),
    secure: process.env.SMTP_SECURE === "true",
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASSWORD
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          }
        : undefined,
  });

  await transporter.sendMail({
    from,
    to: email,
    subject: "StackerDB 비밀번호 재설정",
    text: `아래 링크에서 비밀번호를 재설정하세요.\n\n${resetUrl}\n\n요청하지 않았다면 이 메일을 무시하세요.`,
  });
}
