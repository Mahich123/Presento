import { Hono } from "hono";
import { createAuth } from "./lib/auth";
import { cors } from "hono/cors";
import { type ENV } from "./lib/env";
import { createDb } from "./db";
import { account, room, roomParticipant, roomSlide, session as authSession, user } from "./db/schema";
import { and, eq, isNull, lt } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { generateQuiz, extractSlidesText, QuizError } from "./lib/quiz";
const ROOM_RETENTION_MS = 24 * 60 * 60 * 1000;

async function closeRoom(db: ReturnType<typeof createDb>, roomId: string) {
  await db
    .update(room)
    .set({ isActive: false, closedAt: new Date() })
    .where(eq(room.id, roomId));
}

async function refreshGoogleAccessToken(
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
async function resolveGoogleAccessToken(
  env: ENV,
  db: ReturnType<typeof createDb>,
  userId: string
): Promise<{ ok: true; token: string } | { ok: false; error: string; status: 400 | 401 }> {
  const googleAccount = await db
    .select()
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "google")))
    .limit(1);

  if (googleAccount.length === 0 || !googleAccount[0].accessToken) {
    return { ok: false, error: "Host's Google account not connected", status: 400 };
  }

  let accessToken = googleAccount[0].accessToken;
  const refreshToken = googleAccount[0].refreshToken;
  const tokenExpiry = googleAccount[0].accessTokenExpiresAt;
  const tokenExpired = !tokenExpiry || Date.now() >= Number(tokenExpiry);

  if (tokenExpired) {
    if (!refreshToken) {
      return { ok: false, error: "Token expired, host needs to reconnect Google account", status: 401 };
    }
    const token = await refreshGoogleAccessToken(env, refreshToken);
    if (!token) {
      return { ok: false, error: "Failed to refresh access token", status: 400 };
    }
    await db
      .update(account)
      .set({ accessToken: token, accessTokenExpiresAt: new Date(Date.now() + 55 * 60 * 1000) })
      .where(and(eq(account.userId, userId), eq(account.providerId, "google")));
    accessToken = token;
  }

  return { ok: true, token: accessToken };
}

const app = new Hono<{ Bindings: ENV }>()
  .basePath("/api")

  .use("*", async (c, next) => {
    return cors({
      origin: c.env.TRUSTED_ORIGINS ? c.env.TRUSTED_ORIGINS.split(",") : ["http://localhost:5173"],
      allowHeaders: ["Content-Type", "Authorization", "Cookie"],
      allowMethods: ["POST", "GET", "OPTIONS", "DELETE", "PUT", "PATCH"],
      exposeHeaders: ["Content-Length", "Set-Cookie"],
      credentials: true,
    })(c, next);
  })
  .get("/", (c) => {
    return c.text("Hello Hono!");
  })
  .on(["POST", "GET"], "/auth/*", (c) => {
    const auth = createAuth(c.env);
    const base = new URL(c.env.BACKEND_BASE_URL);
    const incoming = new URL(c.req.raw.url);
    incoming.protocol = base.protocol;
    incoming.host = base.host;
    const rewritten = new Request(incoming.toString(), c.req.raw);
    return auth.handler(rewritten);
  })
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
        await db
          .delete(room)
          .where(
            and(
              eq(room.isActive, false),
              lt(room.closedAt, new Date(Date.now() - ROOM_RETENTION_MS))
            )
          );

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
  })
  .post("/party/:roomId/leave", async (c) => {
    const auth = createAuth(c.env);
    const db = createDb(c.env);
    const roomId = c.req.param("roomId");
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    await db
      .update(roomParticipant)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(roomParticipant.roomId, roomId),
          eq(roomParticipant.userId, session.user.id),
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
      return c.json({ success: true, closed: true });
    }

    return c.json({ success: true, closed: false });
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

    await db
      .update(roomParticipant)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(roomParticipant.roomId, roomId),
          eq(roomParticipant.userId, session.user.id),
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
      return c.json({ success: true, closed: true });
    }

    return c.json({ success: true, closed: false });
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
    const authHeader = c.req.header("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;

    if (!token) {
      return c.json({ error: "Missing bearer token" }, 401);
    }

    const roomId = c.req.query("roomId");

    const rows = await db
      .select({ userId: user.id, userName: user.name })
      .from(authSession)
      .innerJoin(user, eq(authSession.userId, user.id))
      .where(eq(authSession.token, token))
      .limit(1);

    if (!rows.length) {
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
            eq(roomParticipant.userId, rows[0].userId)
          )
        )
        .limit(1);
      role = (participant[0]?.role as "host" | "viewer" | undefined) ?? null;
      isMuted = participant[0]?.isMuted ?? false;
    }

    return c.json({ ...rows[0], role, isMuted });
  })

  .post("/party/:roomId/mute/:targetUserId", async (c) => {
    const db = createDb(c.env);
    const roomId = c.req.param("roomId");
    const targetUserId = c.req.param("targetUserId");

    const authHeader = c.req.header("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    if (!token) return c.json({ error: "Not authenticated" }, 401);

    const sessionRows = await db
      .select({ userId: user.id })
      .from(authSession)
      .innerJoin(user, eq(authSession.userId, user.id))
      .where(eq(authSession.token, token))
      .limit(1);

    if (!sessionRows.length) return c.json({ error: "Invalid session" }, 401);

    const requestingUserId = sessionRows[0].userId;

    
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
    const authHeader = c.req.header("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;

    // Support both cookie auth (browser) and bearer token auth (party/ws clients).
    let requestingUserId = session?.user.id;

    if (!requestingUserId && token) {
      const sessionRows = await db
        .select({ userId: user.id })
        .from(authSession)
        .innerJoin(user, eq(authSession.userId, user.id))
        .where(eq(authSession.token, token))
        .limit(1);

      requestingUserId = sessionRows[0]?.userId;
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
  })

  .post("/room-slide", async (c) => {
    const auth = createAuth(c.env);
    const db = createDb(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Not authenticated" }, 401);

    const body = await c.req.json();
    const { roomId, presentationId, slides } = body as {
      roomId: string;
      presentationId: string;
      slides: { pageId: string; title: string }[];
    };

    if (!roomId || !presentationId || !slides) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const roomData = await db
      .select({ hostName: user.name })
      .from(room)
      .innerJoin(user, eq(room.hostId, user.id))
      .where(eq(room.id, roomId))
      .limit(1);

    if (!roomData.length) return c.json({ error: "Room not found" }, 404);

    const { hostName } = roomData[0];
    const slidesJson = JSON.stringify(slides);

    await db
      .insert(roomSlide)
      .values({ roomId, hostName, presentationId, slides: slidesJson })
      .onConflictDoUpdate({
        target: roomSlide.roomId,
        set: { hostName, presentationId, slides: slidesJson, updatedAt: new Date() },
      });

    return c.json({ success: true, hostName });
  })

  .get("linkGoogle", async (c) => {
    const auth = createAuth(c.env);
    const db = createDb(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    const googleAccount = await db
      .select()
      .from(account)
      .where(
        and(
          eq(account.userId, session.user.id),
          eq(account.providerId, "google")
        )
      )
      .limit(1);

    if (googleAccount.length === 0 || !googleAccount[0].accessToken) {
      return c.json({ error: "Connect Google Drive first" }, 400);
    }

    let accessToken = googleAccount[0].accessToken;
    const refreshToken = googleAccount[0].refreshToken;
    const tokenExpiry = googleAccount[0].accessTokenExpiresAt;

    const now = Date.now();

    const tokenExpired = !tokenExpiry || now >= Number(tokenExpiry);


    if (tokenExpired) {
      if (!refreshToken) {
        return c.json({ error: "No refresh token available" }, 400);
      }

      let token: string | null | undefined;
      try {
        token = await refreshGoogleAccessToken(c.env, refreshToken);
      } catch (err) {
        // e.g. invalid_grant when the refresh token was revoked — needs reconnect.
        console.error("Google token refresh failed:", err);
        return c.json({ error: "Google session expired, please reconnect" }, 401);
      }

      if (!token) {
        return c.json({ error: "Failed to refresh access token" }, 400);
      }

      await db
        .update(account)
        .set({
          accessToken: token,
          accessTokenExpiresAt: new Date(Date.now() + 55 * 60 * 1000),
        })
        .where(
          and(
            eq(account.userId, session.user.id),
            eq(account.providerId, "google")
          )
        );

      accessToken = token;
    }

    const data = await fetch(
      "https://www.googleapis.com/drive/v3/files?pageSize=20&fields=files(id,name,mimeType,modifiedTime)",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const res = await data.json();

    return c.json({ res, accessToken });
  })

  .get("getallAccounts/:userId", async (c) => {
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
  })

  .get("pdf/:fileId",
    zValidator("query", z.object({ roomId: z.string().optional() })),
    async (c) => {
    const auth = createAuth(c.env);
    const db = createDb(c.env);
    const { fileId } = c.req.param();
    const { roomId } = c.req.valid("query");

    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    // Resolve the host so every participant fetches the PDF with the host's token.
    let hostUserId = session.user.id;
    if (roomId) {
      const existingRoom = await db
        .select()
        .from(room)
        .where(eq(room.id, roomId))
        .limit(1);
      if (existingRoom.length > 0) {
        hostUserId = existingRoom[0].hostId;
      }
    }

    const googleAccount = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, hostUserId), eq(account.providerId, "google")))
      .limit(1);

    if (googleAccount.length === 0 || !googleAccount[0].accessToken) {
      return c.json({ error: "Host's Google account not connected" }, 400);
    }

    let accessToken = googleAccount[0].accessToken;
    const refreshToken = googleAccount[0].refreshToken;
    const tokenExpiry = googleAccount[0].accessTokenExpiresAt;
    const tokenExpired = !tokenExpiry || Date.now() >= Number(tokenExpiry);

    if (tokenExpired) {
      if (!refreshToken) {
        return c.json({ error: "Token expired, host needs to reconnect Google account" }, 401);
      }
      const token = await refreshGoogleAccessToken(c.env, refreshToken);
      if (!token) {
        return c.json({ error: "Failed to refresh access token" }, 400);
      }
      await db
        .update(account)
        .set({
          accessToken: token,
          accessTokenExpiresAt: new Date(Date.now() + 55 * 60 * 1000),
        })
        .where(and(eq(account.userId, hostUserId), eq(account.providerId, "google")));
      accessToken = token;
    }

    try {
      const driveRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!driveRes.ok) {
        const errorText = await driveRes.text();
        console.error("Drive PDF fetch error:", errorText);
        return c.json({ error: "Failed to fetch PDF", details: errorText }, driveRes.status as 500);
      }

      const pdfBuffer = await driveRes.arrayBuffer();
      // Credentialed fetch (pdf.js sends cookies) requires a specific origin, not "*".
      const origin = c.req.header("Origin") ?? "*";
      return new Response(pdfBuffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Cache-Control": "private, max-age=3600",
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
        },
      });
    } catch (error) {
      console.error("Error fetching PDF:", error);
      return c.json({ error: "Internal server error", message: error instanceof Error ? error.message : String(error) }, 500);
    }
  })

  .get("slideimage/:presentationId/:pageObjectId",
    zValidator("query", z.object({ roomId: z.string().optional() })),
    async (c) => {
    const auth = createAuth(c.env);
    const db = createDb(c.env);
    const { presentationId, pageObjectId } = c.req.param();
    const { roomId } = c.req.valid("query");

    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    // Get the room to find the host
    let hostUserId = session.user.id;
    
    if (roomId) {
      const existingRoom = await db
        .select()
        .from(room)
        .where(eq(room.id, roomId))
        .limit(1);

      if (existingRoom.length > 0) {
        hostUserId = existingRoom[0].hostId;
      }
    }

    // Get fresh Google access token from the HOST's account
    const googleAccount = await db
      .select()
      .from(account)
      .where(
        and(
          eq(account.userId, hostUserId),
          eq(account.providerId, "google")
        )
      )
      .limit(1);

    if (googleAccount.length === 0 || !googleAccount[0].accessToken) {
      return c.json({ error: "Host's Google account not connected" }, 400);
    }

    let accessToken = googleAccount[0].accessToken;
    const refreshToken = googleAccount[0].refreshToken;
    const tokenExpiry = googleAccount[0].accessTokenExpiresAt;

    const now = Date.now();
    const tokenExpired = !tokenExpiry || now >= Number(tokenExpiry);

    // Refresh token if expired
    if (tokenExpired) {
      if (!refreshToken) {
        return c.json({ error: "Token expired, host needs to reconnect Google account" }, 401);
      }

      const token = await refreshGoogleAccessToken(c.env, refreshToken);

      if (!token) {
        return c.json({ error: "Failed to refresh access token" }, 400);
      }

      await db
        .update(account)
        .set({
          accessToken: token,
          accessTokenExpiresAt: new Date(Date.now() + 55 * 60 * 1000),
        })
        .where(
          and(
            eq(account.userId, hostUserId),
            eq(account.providerId, "google")
          )
        );

      accessToken = token;
    }

    try {
      // Try Slides API thumbnail endpoint first
      const res = await fetch(
        `https://slides.googleapis.com/v1/presentations/${presentationId}/pages/${pageObjectId}/thumbnail`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (res.ok) {
        const data = await res.json() as { contentUrl?: string };
    
        if (data?.contentUrl) {
          const imageRes = await fetch(data.contentUrl, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });

          if (imageRes.ok) {
            const imageBlob = await imageRes.arrayBuffer();
            return new Response(imageBlob, {
              headers: {
                'Content-Type': 'image/png',
                'Cache-Control': 'public, max-age=3600',
                'Access-Control-Allow-Origin': '*',
              },
            });
          }
        }
      }

      // If Slides API fails with permission error, try Drive API export as fallback
      const errorText = await res.text();
      console.error("Slides API error:", errorText);
      
      if (res.status === 403) {
        
        // Get page index from slides data
        const presentationRes = await fetch(
          `https://slides.googleapis.com/v1/presentations/${presentationId}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        if (presentationRes.ok) {
          const presentation = await presentationRes.json() as { slides: Array<{ objectId: string }> };

          const pageIndex = presentation.slides.findIndex((slide: any) => slide.objectId === pageObjectId);
          
          if (pageIndex !== -1) {
            // Use Drive API to export specific page as PNG and proxy it
            const exportUrl = `https://www.googleapis.com/drive/v3/files/${presentationId}/export?mimeType=image/png&page=${pageIndex}`;
            
            const exportRes = await fetch(exportUrl, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            });

            if (exportRes.ok) {
              const imageBlob = await exportRes.arrayBuffer();
              return new Response(imageBlob, {
                headers: {
                  'Content-Type': 'image/png',
                  'Cache-Control': 'public, max-age=3600',
                  'Access-Control-Allow-Origin': '*',
                },
              });
            }
          }
        }
      }

      return c.json({ error: "Error fetching slide data", details: errorText }, res.status as 500);
    } catch (error) {
      console.error("Error fetching slide content:", error);
      return c.json({ error: "Internal server error", message: error instanceof Error ? error.message : String(error) }, 500);
    }
  })
  .post("generate-quiz",
    zValidator("json", z.object({
      provider: z.enum(["anthropic", "openai", "openrouter"]),
      apiKey: z.string().min(1),
      count: z.number().int().min(1).max(10).optional(),
      source: z.discriminatedUnion("type", [
        z.object({
          type: z.literal("slides"),
          presentationId: z.string().min(1),
          roomId: z.string().optional(),
        }),
        z.object({ type: z.literal("text"), text: z.string().min(1) }),
      ]),
    })),
    async (c) => {
      const auth = createAuth(c.env);
      const db = createDb(c.env);

      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!session) {
        return c.json({ error: "Not authenticated" }, 401);
      }

      const { provider, apiKey, count, source } = c.req.valid("json");

      // Gather the deck text from whichever source the host is presenting.
      let deckText: string;
      if (source.type === "text") {
        deckText = source.text;
      } else {
        // Slides: read the presentation with the host's Google token.
        let hostUserId = session.user.id;
        if (source.roomId) {
          const existingRoom = await db
            .select()
            .from(room)
            .where(eq(room.id, source.roomId))
            .limit(1);
          if (existingRoom.length > 0) hostUserId = existingRoom[0].hostId;
        }

        const resolved = await resolveGoogleAccessToken(c.env, db, hostUserId);
        if (!resolved.ok) {
          return c.json({ error: resolved.error }, resolved.status);
        }

        const slidesRes = await fetch(
          `https://slides.googleapis.com/v1/presentations/${source.presentationId}`,
          { headers: { Authorization: `Bearer ${resolved.token}` } }
        );
        if (!slidesRes.ok) {
          const detail = await slidesRes.text();
          console.error("Slides fetch for quiz failed:", detail);
          return c.json({ error: "Couldn't read the slides. Check your Google connection." }, 502);
        }
        deckText = extractSlidesText(await slidesRes.json());
      }

      deckText = deckText.trim();
      if (deckText.length < 40) {
        return c.json(
          { error: "There isn't enough text in this deck to build a quiz. Add slides with more text, or write questions manually." },
          422
        );
      }

      // Cap how much we send to the model — keeps latency and cost sane on big decks.
      const MAX_CHARS = 24000;
      const clipped = deckText.length > MAX_CHARS ? deckText.slice(0, MAX_CHARS) : deckText;

      try {
        const questions = await generateQuiz({
          provider,
          apiKey,
          text: clipped,
          count: count ?? 5,
        });
        return c.json({ questions });
      } catch (err) {
        if (err instanceof QuizError) {
          return c.json({ error: err.message }, err.status as 400);
        }
        console.error("Quiz generation error:", err);
        return c.json({ error: "Quiz generation failed unexpectedly." }, 500);
      }
    });

// export default {
//   port: env.PORT,
//   fetch: app.fetch,
//   hostname: '0.0.0.0'
// };

export type AppType = typeof app;
export { app };
