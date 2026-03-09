import { getEnv } from "./lib/env";
import { app } from "./index";

const env = getEnv(process.env as Record<string, unknown>);

export default {
  port: env.PORT,
  fetch: app.fetch,
  hostname: "0.0.0.0",
};
