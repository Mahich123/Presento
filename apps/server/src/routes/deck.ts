import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { createDb } from "../db";
import { room, roomSlide, user } from "../db/schema";
import { createAuth } from "../lib/auth";
import type { ENV } from "../lib/env";
import { resolveGoogleAccessToken } from "../lib/google";
import { resolveHostUserId } from "../lib/rooms";

const roomQuery = z.object({ roomId: z.string().optional() });

/**
 * The deck the host brought: which slide set a room is showing, and the image
 * and PDF bytes proxied out of the host's Drive so viewers never need their own
 * Google access.
 */
export const deckRoutes = new Hono<{ Bindings: ENV }>()
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

  .get("/pdf/:fileId", zValidator("query", roomQuery), async (c) => {
    const auth = createAuth(c.env);
    const db = createDb(c.env);
    const { fileId } = c.req.param();
    const { roomId } = c.req.valid("query");

    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    // Resolve the host so every participant fetches the PDF with the host's token.
    const hostUserId = await resolveHostUserId(db, session.user.id, roomId);
    const resolved = await resolveGoogleAccessToken(c.env, db, hostUserId);
    if (!resolved.ok) {
      return c.json({ error: resolved.error }, resolved.status);
    }

    try {
      const driveRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${resolved.token}` } }
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

  .get(
    "/slideimage/:presentationId/:pageObjectId",
    zValidator("query", roomQuery),
    async (c) => {
      const auth = createAuth(c.env);
      const db = createDb(c.env);
      const { presentationId, pageObjectId } = c.req.param();
      const { roomId } = c.req.valid("query");

      const session = await auth.api.getSession({ headers: c.req.raw.headers });

      if (!session) {
        return c.json({ error: "Not authenticated" }, 401);
      }

      // Every viewer renders the deck with the host's Google token.
      const hostUserId = await resolveHostUserId(db, session.user.id, roomId);
      const resolved = await resolveGoogleAccessToken(c.env, db, hostUserId);
      if (!resolved.ok) {
        return c.json({ error: resolved.error }, resolved.status);
      }

      const accessToken = resolved.token;

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

            const pageIndex = presentation.slides.findIndex((slide) => slide.objectId === pageObjectId);

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
    }
  );
