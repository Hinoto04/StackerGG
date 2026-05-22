import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createLoginHref } from "@/lib/redirect";

export const SESSION_COOKIE_NAME = "stacker_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type CurrentUser = {
  id: string;
  loginId: string;
  email: string;
  displayName: string | null;
  role: string;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getSessionExpiresAt() {
  return new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
}

function isSecureCookie() {
  return process.env.NODE_ENV === "production";
}

export function createRawToken() {
  return randomBytes(32).toString("base64url");
}

export async function createSession(userId: string) {
  const token = createRawToken();
  const expiresAt = getSessionExpiresAt();

  await prisma.authSession.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookie(),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await prisma.authSession.deleteMany({
      where: {
        tokenHash: hashToken(token),
      },
    });
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const session = await prisma.authSession.findUnique({
    where: {
      tokenHash: hashToken(token),
    },
    select: {
      expiresAt: true,
      user: {
        select: {
          id: true,
          loginId: true,
          email: true,
          displayName: true,
          role: true,
        },
      },
    },
  });

  if (!session || session.expiresAt.getTime() <= Date.now()) {
    if (session) {
      await prisma.authSession.deleteMany({
        where: {
          tokenHash: hashToken(token),
        },
      });
    }

    return null;
  }

  return session.user;
}

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    const headerStore = await headers();
    redirect(createLoginHref(headerStore.get("x-current-path")));
  }

  return user;
}

export async function requireAdmin() {
  const user = await requireUser();

  if (user.role !== "ADMIN") {
    redirect("/");
  }

  return user;
}

export function isAdmin(user: CurrentUser | null) {
  return user?.role === "ADMIN";
}

export function canManageDeck(user: CurrentUser | null, deck: { authorId: string }) {
  return Boolean(user && (user.role === "ADMIN" || deck.authorId === user.id));
}

export function hashOpaqueToken(token: string) {
  return hashToken(token);
}
