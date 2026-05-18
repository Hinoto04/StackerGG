import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { GOOGLE_OAUTH_COOKIE_NAME } from "@/lib/oauth";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

function getBaseUrl() {
  return process.env.AUTH_BASE_URL || "http://localhost:3000";
}

function base64Url(input: Buffer) {
  return input.toString("base64url");
}

function createCodeChallenge(verifier: string) {
  return base64Url(createHash("sha256").update(verifier).digest());
}

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return NextResponse.redirect(new URL("/login?oauth=missing_google_client_id", getBaseUrl()));
  }

  const state = base64Url(randomBytes(24));
  const codeVerifier = base64Url(randomBytes(48));
  const redirectUri = `${getBaseUrl()}/auth/google/callback`;
  const searchParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: createCodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });

  const cookieStore = await cookies();
  cookieStore.set(GOOGLE_OAUTH_COOKIE_NAME, JSON.stringify({ state, codeVerifier }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });

  return NextResponse.redirect(`${GOOGLE_AUTH_URL}?${searchParams.toString()}`);
}
