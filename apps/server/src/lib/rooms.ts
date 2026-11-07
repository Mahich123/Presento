import { and, eq, isNull, lt } from "drizzle-orm";

import type { Db } from "../db";
import { room, roomParticipant } from "../db/schema";
import { userFromBearerToken } from "./session";

/** How long a closed room's row survives before the next room creation sweeps it. */
export const ROOM_RETENTION_MS = 24 * 60 * 60 * 1000;

export async function closeRoom(db: Db, roomId: string) {
  await db
    .update(room)
    .set({ isActive: false, closedAt: new Date() })
    .where(eq(room.id, roomId));
}

export async function purgeExpiredRooms(db: Db) {
  await db
    .delete(room)
    .where(
      and(
        eq(room.isActive, false),
        lt(room.closedAt, new Date(Date.now() - ROOM_RETENTION_MS))
      )
    );
}

/**
 * Marks the caller as gone and closes the room if that emptied it.
 * Leaving and disconnecting are the same thing to the database — the only
 * difference is what the client was doing when it happened.
 */
export async function departRoom(db: Db, roomId: string, userId: string) {
  await db
    .update(roomParticipant)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(roomParticipant.roomId, roomId),
        eq(roomParticipant.userId, userId),
        isNull(roomParticipant.leftAt)
      )
    );

  const activeParticipants = await db
    .select({ id: roomParticipant.id })
    .from(roomParticipant)
    .where(
      and(eq(roomParticipant.roomId, roomId), isNull(roomParticipant.leftAt))
    );

  if (activeParticipants.length === 0) {
    await closeRoom(db, roomId);
    return { success: true as const, closed: true as const };
  }

  return { success: true as const, closed: false as const };
}

/** The inverse of departRoom: the caller is back, so clear their leave. */
export async function markPresent(db: Db, roomId: string, userId: string) {
  await db
    .update(roomParticipant)
    .set({ leftAt: null, joinedAt: new Date() })
    .where(
      and(eq(roomParticipant.roomId, roomId), eq(roomParticipant.userId, userId))
    );
}

/**
 * Who a session token belongs to, and their standing in the room. Null when the
 * token matches no session; role is null when they aren't a participant.
 */
export async function resolveRoomUser(db: Db, token: string, roomId: string) {
  const sessionUser = await userFromBearerToken(db, token);
  if (!sessionUser) return null;

  const [participant] = await db
    .select({ role: roomParticipant.role, isMuted: roomParticipant.isMuted })
    .from(roomParticipant)
    .where(
      and(
        eq(roomParticipant.roomId, roomId),
        eq(roomParticipant.userId, sessionUser.userId)
      )
    )
    .limit(1);

  return {
    ...sessionUser,
    role: (participant?.role as "host" | "viewer" | undefined) ?? null,
    isMuted: participant?.isMuted ?? false,
  };
}

/**
 * Flips a participant's mute and returns the new state. Null when the caller
 * isn't the room's host or the target isn't in the room.
 */
export async function toggleMute(
  db: Db,
  roomId: string,
  hostUserId: string,
  targetUserId: string
): Promise<boolean | null> {
  const [existingRoom] = await db
    .select({ hostId: room.hostId })
    .from(room)
    .where(eq(room.id, roomId))
    .limit(1);

  if (existingRoom?.hostId !== hostUserId) return null;

  const target = and(
    eq(roomParticipant.roomId, roomId),
    eq(roomParticipant.userId, targetUserId)
  );
  const [participant] = await db
    .select({ isMuted: roomParticipant.isMuted })
    .from(roomParticipant)
    .where(target)
    .limit(1);

  if (!participant) return null;

  const isMuted = !participant.isMuted;
  await db.update(roomParticipant).set({ isMuted }).where(target);
  return isMuted;
}

/**
 * Slides, PDFs and quiz text are all read with the HOST's Google token, so a
 * viewer's request has to resolve to whoever opened the room. Falls back to the
 * caller when there is no room (e.g. the host previewing before sharing).
 */
export async function resolveHostUserId(
  db: Db,
  callerUserId: string,
  roomId?: string
): Promise<string> {
  if (!roomId) return callerUserId;

  const existingRoom = await db
    .select()
    .from(room)
    .where(eq(room.id, roomId))
    .limit(1);

  return existingRoom.length > 0 ? existingRoom[0].hostId : callerUserId;
}
