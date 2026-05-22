import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { GOOGLE_OAUTH_COOKIE_NAME } from "@/lib/oauth";
import { prisma } from "@/lib/prisma";
import { createLoginHref, getSafeRedirectPath } from "@/lib/redirect";

type GoogleUserInfo = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
};

function getBaseUrl() {
  return process.env.AUTH_BASE_URL || "http://localhost:3000";
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function createOAuthLoginId(email: string) {
  return `google_${email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "_")}`.slice(0, 24);
}

async function getUniqueLoginId(baseLoginId: string) {
  let loginId = baseLoginId || "google_user";
  let suffix = 1;

  while (await prisma.user.findUnique({ where: { loginId }, select: { id: true } })) {
    loginId = `${baseLoginId.slice(0, 19)}_${suffix}`;
    suffix += 1;
  }

  return loginId;
}

async function exchangeCodeForAccessToken(code: string, codeVerifier: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: `${getBaseUrl()}/auth/google/callback`,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${response.status}`);
  }

  const payload = await response.json();

  if (!payload.access_token) {
    throw new Error("Google token response did not include access_token");
  }

  return String(payload.access_token);
}

async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Google userinfo failed: ${response.status}`);
  }

  return response.json();
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(GOOGLE_OAUTH_COOKIE_NAME)?.value;

  cookieStore.delete(GOOGLE_OAUTH_COOKIE_NAME);

  if (!code || !state || !cookieValue || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(new URL("/login?oauth=invalid_google_response", getBaseUrl()));
  }

  let storedState = "";
  let codeVerifier = "";
  let nextPath = "/";

  try {
    const parsed = JSON.parse(cookieValue);
    storedState = parsed.state;
    codeVerifier = parsed.codeVerifier;
    nextPath = getSafeRedirectPath(parsed.nextPath);
  } catch {
    return NextResponse.redirect(new URL("/login?oauth=invalid_google_state", getBaseUrl()));
  }

  if (state !== storedState || !codeVerifier) {
    const loginUrl = new URL(createLoginHref(nextPath), getBaseUrl());
    loginUrl.searchParams.set("oauth", "invalid_google_state");

    return NextResponse.redirect(loginUrl);
  }

  try {
    const accessToken = await exchangeCodeForAccessToken(code, codeVerifier);
    const googleUser = await fetchGoogleUserInfo(accessToken);
    const email = normalizeEmail(googleUser.email);

    if (!googleUser.sub || !email) {
      throw new Error("Google profile is missing sub or email");
    }

    const account = await prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "google",
          providerAccountId: googleUser.sub,
        },
      },
      select: {
        userId: true,
      },
    });

    let userId = account?.userId;

    if (!userId) {
      const existingUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });

      if (existingUser) {
        userId = existingUser.id;
      } else {
        const user = await prisma.user.create({
          data: {
            loginId: await getUniqueLoginId(createOAuthLoginId(email)),
            email,
            displayName: googleUser.name || email,
            role: "USER",
          },
          select: {
            id: true,
          },
        });
        userId = user.id;
      }

      await prisma.oAuthAccount.create({
        data: {
          userId,
          provider: "google",
          providerAccountId: googleUser.sub,
          email,
        },
      });
    }

    await createSession(userId);
    return NextResponse.redirect(new URL(nextPath, getBaseUrl()));
  } catch (error) {
    console.error("Google OAuth failed", error);
    const loginUrl = new URL(createLoginHref(nextPath), getBaseUrl());
    loginUrl.searchParams.set("oauth", "google_failed");

    return NextResponse.redirect(loginUrl);
  }
}
