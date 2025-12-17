import {z} from 'zod'

export const envSchema = z.object({
  TURSO_DB_URL: z.string(),
  TURSO_DB_AUTH_TOKEN: z.string(),
  GITHUB_CLIENT_ID: z.string(),
  GITHUB_CLIENT_SECRET: z.string(),
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  GOOGLE_REDIRECT_URL: z.string(),
  PARTYKIT_SERVER_URL: z.string(),
  PORT:z.string()
})
export type ENV = z.infer<typeof envSchema>

export const env = envSchema.parse(process.env);