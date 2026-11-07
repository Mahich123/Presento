import { Hono } from "hono";
import { eq } from "drizzle-orm";

import { createDb } from "../db";
import { account } from "../db/schema";
import { createAuth } from "../lib/auth";
import type { ENV } from "../lib/env";
import {
  findGoogleAccount,
  isAccessTokenExpired,
  refreshGoogleAccessToken,
  storeGoogleAccessToken,
} from "../lib/google";

/** The signed-in user's own connections: a fresh Google token, and which providers they linked. */
export const googleRoutes = new Hono<{ Bindings: ENV }>()
  .get("/linkGoogle", async (c) => {
    const auth = createAuth(c.env);
    const db = createDb(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    const googleAccount = await findGoogleAccount(db, session.user.id);

    if (!googleAccount?.accessToken) {
      return c.json({ error: "Connect Google Drive first" }, 400);
    }

    // Deliberately not resolveGoogleAccessToken: this is the host reconnecting
    // their own account, so the wording and the statuses are about them, not
    // about a room they are viewing.
    let accessToken = googleAccount.accessToken;

    if (isAccessTokenExpired(googleAccount.accessTokenExpiresAt)) {
      if (!googleAccount.refreshToken) {
        return c.json({ error: "No refresh token available" }, 400);
      }

      let token: string | null | undefined;
      try {
        token = await refreshGoogleAccessToken(c.env, googleAccount.refreshToken);
      } catch (err) {
        // e.g. invalid_grant when the refresh token was revoked — needs reconnect.
        console.error("Google token refresh failed:", err);
        return c.json({ error: "Google session expired, please reconnect" }, 401);
      }

      if (!token) {
        return c.json({ error: "Failed to refresh access token" }, 400);
      }

      await storeGoogleAccessToken(db, session.user.id, token);

      accessToken = token;
    }

    return c.json({ accessToken });
  })

  .get("/accounts", async (c) => {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    // Which providers are linked, never their tokens: /linkGoogle is the one
    // place a token leaves the server, and only to its owner.
    const linked = await createDb(c.env)
      .select({ id: account.id, providerId: account.providerId })
      .from(account)
      .where(eq(account.userId, session.user.id));

    return c.json(linked);
  });
