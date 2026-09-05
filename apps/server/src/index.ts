import { Hono } from "hono";
import { cors } from "hono/cors";

import { type ENV } from "./lib/env";
import { authRoutes } from "./routes/auth";
import { deckRoutes } from "./routes/deck";
import { googleRoutes } from "./routes/google";
import { partyRoutes } from "./routes/party";
import { quizRoutes } from "./routes/quiz";

/**
 * The API's composition root. Every route lives in ./routes and is mounted flat
 * at the base path, so the URLs are exactly the strings written in each module
 * — PartyKit and the client both address these paths literally.
 *
 * Keep the chain unbroken: `AppType` is inferred from it, and the client's
 * typed `hc<AppType>` calls are only as good as what this expression returns.
 */
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
  .route("/", authRoutes)
  .route("/", partyRoutes)
  .route("/", deckRoutes)
  .route("/", googleRoutes)
  .route("/", quizRoutes);

export type AppType = typeof app;
export { app };
