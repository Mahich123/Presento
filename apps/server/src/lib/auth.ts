import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/index";
import * as schema from "../db/schema";
import { env } from "./env";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
  }),
  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID as string,
      clientSecret: env.GITHUB_CLIENT_SECRET as string,
      redirectURI: "http://localhost:3001/api/auth/callback/github",
      prompt: "select_account"
    }
    // google: {
    //   clientId: process.env.GOOGLE_CLIENT_ID as string,
    //   clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    //   redirectURI: "http://localhost:3001/api/auth/callback/google",
    // },
  },
  baseURL: "http://localhost:3001",
  trustedOrigins: ["http://localhost:5173"],
});
