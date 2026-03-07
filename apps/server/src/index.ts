import { Hono } from "hono";
import { auth } from "./lib/auth";
import { cors } from "hono/cors";
import { env } from "./lib/env";
import { google } from "googleapis";
import { db } from "./db";
import { account, room, roomParticipant, roomSlide, session as authSession, user } from "./db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const oauth2Client = new google.auth.OAuth2(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URL
);

const app = new Hono()
  .basePath("/api")

  .use(
    "*",
    cors({
      origin: env.TRUSTED_ORIGINS ? env.TRUSTED_ORIGINS.split(",") : ["http://localhost:5173"],
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["POST", "GET", "OPTIONS"],
      exposeHeaders: ["Content-Length"],
      credentials: true,
    })
  )
  .get("/", (c) => {
    return c.text("Hello Hono!");
  })
  .on(["POST", "GET"], "/auth/*", (c) => {
    return auth.handler(c.req.raw);
  })
  .post(
    "/party/:roomId",
    zValidator("json", z.object({ isJoining: z.boolean().optional() })),
    async (c) => {
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
          return c.json({ error: "Room is inactive" }, 403);
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

    const partyKitUrl = `${env.PARTYKIT_SERVER_URL}/parties/main/${roomId}`;

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
      await db.delete(room).where(eq(room.id, roomId));
      return c.json({ success: true, deleted: true });
    }

    return c.json({ success: true, deleted: false });
  })
  .post("/party/:roomId/presence", async (c) => {
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
      await db.delete(room).where(eq(room.id, roomId));
      return c.json({ success: true, deleted: true });
    }

    return c.json({ success: true, deleted: false });
  })
  .post("/party/:roomId/close", async (c) => {
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

    await db.delete(room).where(eq(room.id, roomId));
    return c.json({ success: true, deleted: true });
  })

  .get("/party/session-user", async (c) => {
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

    if (roomId) {
      const participant = await db
        .select({ role: roomParticipant.role })
        .from(roomParticipant)
        .where(
          and(
            eq(roomParticipant.roomId, roomId),
            eq(roomParticipant.userId, rows[0].userId)
          )
        )
        .limit(1);
      role = (participant[0]?.role as "host" | "viewer" | undefined) ?? null;
    }

    let isMuted = false;
    if (roomId && role) {
      const participantRow = await db
        .select({ isMuted: roomParticipant.isMuted })
        .from(roomParticipant)
        .where(
          and(
            eq(roomParticipant.roomId, roomId),
            eq(roomParticipant.userId, rows[0].userId)
          )
        )
        .limit(1);
      isMuted = participantRow[0]?.isMuted ?? false;
    }

    return c.json({ ...rows[0], role, isMuted });
  })

  .post("/party/:roomId/mute/:targetUserId", async (c) => {
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

  .post("/room-slide", async (c) => {
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

      oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });

      const { token } = await oauth2Client.getAccessToken();

      if (!token) {
        return c.json({ error: "Failed to refresh access token" }, 400);
      }

      await db
        .update(account)
        .set({
          accessToken: token,
          accessTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
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

  .get("slideimage/:presentationId/:pageObjectId",
    zValidator("query", z.object({ roomId: z.string().optional() })),
    async (c) => {
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

      oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });

      const { token } = await oauth2Client.getAccessToken();

      if (!token) {
        return c.json({ error: "Failed to refresh access token" }, 400);
      }

      await db
        .update(account)
        .set({
          accessToken: token,
          accessTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
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
        console.log("Attempting fallback to Drive API export...");
        
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
  });

export default {
  port: env.PORT,
  fetch: app.fetch,
  hostname: '0.0.0.0'
};

export type AppType = typeof app;
export { app };
