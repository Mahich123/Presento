import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb } from "../db/index";
import * as schema from "../db/schema";
import type { ENV } from "./env";

export function createAuth(env: ENV) {
  const db = createDb(env);
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        redirectURI: `${env.BACKEND_BASE_URL}/api/auth/callback/github`,
        prompt: "select_account",
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectURI: `${env.BACKEND_BASE_URL}/api/auth/callback/google`,
        scope: [
          "openid",
          "email",
          "profile",
          "https://www.googleapis.com/auth/drive.readonly",
          "https://www.googleapis.com/auth/presentations.readonly",
        ],
        prompt: "consent",
      },
    },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["github", "google"],
    },
  },
  baseURL: env.BACKEND_BASE_URL!,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: env.TRUSTED_ORIGINS 
    ? env.TRUSTED_ORIGINS.split(",") 
    : ["http://localhost:5173"],
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
    },
  },
});
}