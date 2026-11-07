import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createDb } from "../db";
import { room, roomParticipant } from "../db/schema";
import { createAuth } from "../lib/auth";
import type { ENV } from "../lib/env";
import {
  departRoom,
  purgeExpiredRooms,
} from "../lib/rooms";
import { bearerToken, userFromBearerToken } from "../lib/session";

/**
 * Room membership over HTTP: opening and joining a room, leaving it, and the
 * host's participant list. The live room calls lib/rooms directly instead.
 */
export const partyRoutes = new Hono<{ Bindings: ENV }>()
  .post(
    "/party/:roomId",
    zValidator("json", z.object({ isJoining: z.boolean().optional() })),
    async (c) => {
      const auth = createAuth(c.env);
      const db = createDb(c.env);
      const roomId = c.req.param("roomId");
      const session = await auth.api.getSession({ headers: c.req.raw.headers });

      if (!session) {
        return c.json({ error: "Not authenticated" }, 401);
      }

      const body = c.req.valid("json");
      const isJoining = body?.isJoining || false;
      let userRole = "viewer";

      try {
        if (!isJoining) {
          await purgeExpiredRooms(db);

          await db.insert(room).values({
            id: roomId,
            hostId: session.user.id,
          });

          await db.insert(roomParticipant).values({
            roomId: roomId,
            userId: session.user.id,
            role: "host",
          });
          userRole = "host";
        } else {
          const existingRoom = await db
            .select()
            .from(room)
            .where(eq(room.id, roomId))
            .limit(1);

          if (existingRoom.length === 0) {
            return c.json({ error: "Room does not exist" }, 404);
          }

          if (!existingRoom[0].isActive) {
            if (existingRoom[0].hostId !== session.user.id) {
              return c.json(
                { error: "This room hasn't been opened by the host yet." },
                403
              );
            }
            await db
              .update(room)
              .set({ isActive: true, closedAt: null })
              .where(eq(room.id, roomId));
          }

          const alreadyParticipant = await db
            .select()
            .from(roomParticipant)
            .where(
              and(
                eq(roomParticipant.roomId, roomId),
                eq(roomParticipant.userId, session.user.id)
              )
            )
            .limit(1);

          if (alreadyParticipant.length === 0) {
            await db.insert(roomParticipant).values({
              roomId: roomId,
              userId: session.user.id,
              role: "viewer",
            })
            userRole = "viewer";
          } else {
            await db
              .update(roomParticipant)
              .set({
                leftAt: null,
                joinedAt: new Date(),
              })
              .where(eq(roomParticipant.id, alreadyParticipant[0].id));
            userRole = alreadyParticipant[0].role;
          }
        }
      } catch (error) {
        return c.json({ error: "Failed to create room" }, 500);
      }

      return c.json({ role: userRole });
    }
  )
  .post("/party/:roomId/leave", async (c) => {
    const auth = createAuth(c.env);
    const db = createDb(c.env);
    const roomId = c.req.param("roomId");
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    return c.json(await departRoom(db, roomId, session.user.id));
  })
  .get("/party/:roomId/participants", async (c) => {
    const auth = createAuth(c.env);
    const db = createDb(c.env);
    const roomId = c.req.param("roomId");
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const token = bearerToken(c.req.header("Authorization"));

    // Support both cookie auth (browser) and bearer token auth (party/ws clients).
    let requestingUserId = session?.user.id;

    if (!requestingUserId && token) {
      requestingUserId = (await userFromBearerToken(db, token))?.userId;
    }

    if (!requestingUserId) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    const hostCheck = await db
      .select({ hostId: room.hostId })
      .from(room)
      .where(eq(room.id, roomId))
      .limit(1);

    if (!hostCheck.length || hostCheck[0].hostId !== requestingUserId) {
      return c.json({ error: "Only the host can view participants" }, 403);
    }

    const participants = await db
      .select({
        userId: roomParticipant.userId,
        role: roomParticipant.role,
        isMuted: roomParticipant.isMuted,
        joinedAt: roomParticipant.joinedAt,
        leftAt: roomParticipant.leftAt,
      })
      .from(roomParticipant)
      .where(eq(roomParticipant.roomId, roomId));

    return c.json({ participants });
  });
