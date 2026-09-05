import { and, eq, isNull, lt } from "drizzle-orm";

import type { Db } from "../db";
import { room, roomParticipant } from "../db/schema";

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
