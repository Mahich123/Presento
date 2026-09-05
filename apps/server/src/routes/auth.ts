import { Hono } from "hono";

import { createAuth } from "../lib/auth";
import type { ENV } from "../lib/env";

/**
 * better-auth handles this whole subtree itself. The URL is rewritten onto
 * BACKEND_BASE_URL first because the Worker sees the internal request host,
 * and better-auth builds its callback and cookie URLs from what it is given.
 */
export const authRoutes = new Hono<{ Bindings: ENV }>()
  .on(["POST", "GET"], "/auth/*", (c) => {
    const auth = createAuth(c.env);
    const base = new URL(c.env.BACKEND_BASE_URL);
    const incoming = new URL(c.req.raw.url);
    incoming.protocol = base.protocol;
    incoming.host = base.host;
    const rewritten = new Request(incoming.toString(), c.req.raw);
    return auth.handler(rewritten);
  });
