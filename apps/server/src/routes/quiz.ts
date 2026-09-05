import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { createDb } from "../db";
import { createAuth } from "../lib/auth";
import type { ENV } from "../lib/env";
import { resolveGoogleAccessToken } from "../lib/google";
import { extractSlidesText, generateQuiz, QuizError } from "../lib/quiz";
import { resolveHostUserId } from "../lib/rooms";

/** Cap how much we send to the model — keeps latency and cost sane on big decks. */
const MAX_CHARS = 24000;

const quizRequest = z.object({
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
});

/** Questions written from the deck the host is already presenting. */
export const quizRoutes = new Hono<{ Bindings: ENV }>()
  .post("/generate-quiz", zValidator("json", quizRequest), async (c) => {
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
      const hostUserId = await resolveHostUserId(db, session.user.id, source.roomId);

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
