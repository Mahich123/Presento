import { eq } from "drizzle-orm";

import type { Db } from "../db";
import { session as authSession, user } from "../db/schema";

/**
 * PartyKit and the websocket clients cannot send cookies, so they authenticate
 * with the session token as a bearer instead.
 */
export function bearerToken(authHeader: string | undefined): string | null {
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
}

export async function userFromBearerToken(db: Db, token: string) {
  const rows = await db
    .select({ userId: user.id, userName: user.name })
    .from(authSession)
    .innerJoin(user, eq(authSession.userId, user.id))
    .where(eq(authSession.token, token))
    .limit(1);

  return rows[0] ?? null;
}
