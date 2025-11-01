import { defineConfig } from "drizzle-kit";
import { env } from "./src/lib/env";

export default defineConfig({
  schema: "src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: env.TURSO_DB_URL!,
    authToken: env.TURSO_DB_AUTH_TOKEN!,
  },
  verbose: true,
  strict: true,
});