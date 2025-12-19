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

    return c.json({ role: userRole }, { status: resp.status });
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

    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    try {
      const res = await fetch(
        `https://slides.googleapis.com/v1/presentations/${presentationId}/pages/${pageObjectId}/thumbnail`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!res.ok) {
        throw new Error("Error fetching slide data");
      }

      const data = await res.json();

      return c.json(data);
    } catch (error) {
      console.error("Error fetching slide content:", error);
    }
  });

export default {
  port: env.PORT,
  fetch: app.fetch,
};

export type AppType = typeof app;
export { app };
