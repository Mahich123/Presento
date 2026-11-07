import { routePartykitRequest } from "partyserver";

import { app } from "./index";
import type { ENV } from "./lib/env";

// Durable Object classes have to be exported from the Worker's entry module.
export { Room } from "./party/room";

export default {
  async fetch(request, env, ctx) {
    // /parties/room/:roomId is a room's websocket; everything else is the API.
    return (await routePartykitRequest(request, env)) ?? app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<ENV>;
