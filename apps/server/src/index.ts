import { Hono } from "hono";
import { auth } from "./lib/auth";
import { cors } from "hono/cors";
import { env } from "./lib/env";
import { google } from "googleapis";
import { db } from "./db";
import { account, room, roomParticipant } from "./db/schema";
import { and, eq, is } from "drizzle-orm";

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
      origin: "http://localhost:5173",
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
  .post("/party/:roomId", async (c) => {
    const roomId = c.req.param("roomId");
    const authHeader = c.req.header("Authorization");
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    const body = await c.req.json();
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

  .get("slideimage/:presentationId/:pageObjectId", async (c) => {
    const { presentationId, pageObjectId } = c.req.param();
    const roomId = c.req.query("roomId");

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
};

export type AppType = typeof app;
export { app };
