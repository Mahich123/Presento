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

/** The host's own Google connection: listing their Drive, and which providers they linked. */
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

    const data = await fetch(
      "https://www.googleapis.com/drive/v3/files?pageSize=20&fields=files(id,name,mimeType,modifiedTime)",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const res = await data.json();

    return c.json({ res, accessToken });
  })

  .get("/getallAccounts/:userId", async (c) => {
    const db = createDb(c.env);
    const userId = c.req.param("userId");
    const accountProviders = await db
      .select({
        providerId: account.providerId,
        accessToken: account.accessToken,
      })
      .from(account)
      .where(eq(account.userId, userId));

    return c.json(accountProviders);
  });
