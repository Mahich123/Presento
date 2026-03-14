import { defineConfig } from "drizzle-kit";
import type { ENV } from "./src/lib/env";

type DrizzleEnv = Pick<ENV, "TURSO_DB_URL" | "TURSO_DB_AUTH_TOKEN">;
const env = process.env as Partial<DrizzleEnv>;

function requireEnv<K extends keyof DrizzleEnv>(key: K): DrizzleEnv[K] {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

export default defineConfig({
  schema: "src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: requireEnv("TURSO_DB_URL"),
    authToken: requireEnv("TURSO_DB_AUTH_TOKEN"),
  },
  verbose: true,
  strict: true,
});