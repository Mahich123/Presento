import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createDb } from "../db";
import { room, roomParticipant } from "../db/schema";
import { createAuth } from "../lib/auth";
import type { ENV } from "../lib/env";
import {
  closeRoom,
  departRoom,
  purgeExpiredRooms,
} from "../lib/rooms";
import { bearerToken, userFromBearerToken } from "../lib/session";

/**
 * Room membership and moderation: opening and joining a room, leaving it,
 * presence from the websocket, and the host-only controls.
 */
export const partyRoutes = new Hono<{ Bindings: ENV }>()
  .post(
    "/party/:roomId",
    zValidator("json", z.object({ isJoining: z.boolean().optional() })),
    async (c) => {
      const auth = createAuth(c.env);
      const db = createDb(c.env);
      const roomId = c.req.param("roomId");
      const authHeader = c.req.header("Authorization");
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

      const partyKitUrl = `${c.env.PARTYKIT_SERVER_URL}/parties/main/${roomId}`;

      const bodyText = JSON.stringify(body);

      const resp = await fetch(partyKitUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader || "",
        },
        body: bodyText,
      });

      return c.json({ role: userRole }, resp.status as 200);
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
  .post("/party/:roomId/presence", async (c) => {
    const auth = createAuth(c.env);
    const db = createDb(c.env);
    const roomId = c.req.param("roomId");
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const event = body?.event as "connect" | "disconnect" | undefined;

    if (event !== "connect" && event !== "disconnect") {
      return c.json({ error: "Invalid event" }, 400);
    }

    if (event === "connect") {
      await db
        .update(roomParticipant)
        .set({
          leftAt: null,
          joinedAt: new Date(),
        })
        .where(
          and(
            eq(roomParticipant.roomId, roomId),
            eq(roomParticipant.userId, session.user.id)
          )
        );
      return c.json({ success: true });
    }

    return c.json(await departRoom(db, roomId, session.user.id));
  })
  .post("/party/:roomId/close", async (c) => {
    const auth = createAuth(c.env);
    const db = createDb(c.env);
    const roomId = c.req.param("roomId");
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    const participant = await db
      .select({ id: roomParticipant.id })
      .from(roomParticipant)
      .where(
        and(
          eq(roomParticipant.roomId, roomId),
          eq(roomParticipant.userId, session.user.id)
        )
      )
      .limit(1);

    if (!participant.length) {
      return c.json({ error: "Not a participant" }, 403);
    }

    await closeRoom(db, roomId);
    return c.json({ success: true, closed: true });
  })

  .get("/party/session-user", async (c) => {
    const db = createDb(c.env);
    const token = bearerToken(c.req.header("Authorization"));

    if (!token) {
      return c.json({ error: "Missing bearer token" }, 401);
    }

    const roomId = c.req.query("roomId");

    const sessionUser = await userFromBearerToken(db, token);

    if (!sessionUser) {
      return c.json({ error: "Invalid session token" }, 401);
    }

    let role: "host" | "viewer" | null = null;
    let isMuted = false;

    if (roomId) {
      const participant = await db
        .select({ role: roomParticipant.role, isMuted: roomParticipant.isMuted })
        .from(roomParticipant)
        .where(
          and(
            eq(roomParticipant.roomId, roomId),
            eq(roomParticipant.userId, sessionUser.userId)
          )
        )
        .limit(1);
      role = (participant[0]?.role as "host" | "viewer" | undefined) ?? null;
      isMuted = participant[0]?.isMuted ?? false;
    }

    return c.json({ ...sessionUser, role, isMuted });
  })

  .post("/party/:roomId/mute/:targetUserId", async (c) => {
    const db = createDb(c.env);
    const roomId = c.req.param("roomId");
    const targetUserId = c.req.param("targetUserId");

    const token = bearerToken(c.req.header("Authorization"));
    if (!token) return c.json({ error: "Not authenticated" }, 401);

    const sessionUser = await userFromBearerToken(db, token);
    if (!sessionUser) return c.json({ error: "Invalid session" }, 401);

    const requestingUserId = sessionUser.userId;

    const hostCheck = await db
      .select({ hostId: room.hostId })
      .from(room)
      .where(eq(room.id, roomId))
      .limit(1);

    if (!hostCheck.length || hostCheck[0].hostId !== requestingUserId) {
      return c.json({ error: "Only the host can mute users" }, 403);
    }

    const participant = await db
      .select({ isMuted: roomParticipant.isMuted })
      .from(roomParticipant)
      .where(
        and(
          eq(roomParticipant.roomId, roomId),
          eq(roomParticipant.userId, targetUserId)
        )
      )
      .limit(1);

    if (!participant.length) {
      return c.json({ error: "User not found in room" }, 404);
    }

    const newMuteState = !participant[0].isMuted;

    await db
      .update(roomParticipant)
      .set({ isMuted: newMuteState })
      .where(
        and(
          eq(roomParticipant.roomId, roomId),
          eq(roomParticipant.userId, targetUserId)
        )
      );

    return c.json({ success: true, isMuted: newMuteState });
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
