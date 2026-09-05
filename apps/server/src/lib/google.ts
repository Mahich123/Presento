import { and, eq } from "drizzle-orm";

import type { Db } from "../db";
import { account } from "../db/schema";
import type { ENV } from "./env";

/** Google access tokens last an hour; refresh a little early so we never race the expiry. */
const ACCESS_TOKEN_TTL_MS = 55 * 60 * 1000;

export async function refreshGoogleAccessToken(
  env: ENV,
  refreshToken: string
): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Google token refresh failed (${res.status}): ${await res.text()}`
    );
  }

  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

export async function findGoogleAccount(db: Db, userId: string) {
  const rows = await db
    .select()
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "google")))
    .limit(1);

  return rows[0] ?? null;
}

export async function storeGoogleAccessToken(db: Db, userId: string, token: string) {
  await db
    .update(account)
    .set({
      accessToken: token,
      accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
    })
    .where(and(eq(account.userId, userId), eq(account.providerId, "google")));
}

export function isAccessTokenExpired(expiresAt: Date | null | undefined): boolean {
  return !expiresAt || Date.now() >= Number(expiresAt);
}

type ResolvedToken =
  | { ok: true; token: string }
  | { ok: false; error: string; status: 400 | 401 };

/**
 * The token a media or quiz route needs, refreshed if stale. Callers that want
 * their own wording (the Drive picker does) should compose the pieces above
 * instead — these messages are what the deck-serving routes have always sent.
 */
export async function resolveGoogleAccessToken(
  env: ENV,
  db: Db,
  userId: string
): Promise<ResolvedToken> {
  const googleAccount = await findGoogleAccount(db, userId);

  if (!googleAccount?.accessToken) {
    return { ok: false, error: "Host's Google account not connected", status: 400 };
  }

  if (!isAccessTokenExpired(googleAccount.accessTokenExpiresAt)) {
    return { ok: true, token: googleAccount.accessToken };
  }

  if (!googleAccount.refreshToken) {
    return {
      ok: false,
      error: "Token expired, host needs to reconnect Google account",
      status: 401,
    };
  }

  const token = await refreshGoogleAccessToken(env, googleAccount.refreshToken);
  if (!token) {
    return { ok: false, error: "Failed to refresh access token", status: 400 };
  }

  await storeGoogleAccessToken(db, userId, token);
  return { ok: true, token };
}
