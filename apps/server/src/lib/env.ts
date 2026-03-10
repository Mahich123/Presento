import {z} from 'zod'

export const envSchema = z.object({
  TURSO_DB_URL: z.string(),
  TURSO_DB_AUTH_TOKEN: z.string(),
  GITHUB_CLIENT_ID: z.string(),
  GITHUB_CLIENT_SECRET: z.string(),
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  PARTYKIT_SERVER_URL: z.string(),
  BACKEND_BASE_URL: z.string(),
  BETTER_AUTH_SECRET: z.string(),
  TRUSTED_ORIGINS: z.string().optional(),
  PORT: z.coerce.number().optional()
})
export type ENV = z.infer<typeof envSchema>

// In CF Workers, env bindings are passed per-request via c.env — not process.env.
// Call getEnv(c.env) inside route handlers; do NOT call at module load time.
export function getEnv(rawEnv: Record<string, unknown>): ENV {
  return envSchema.parse(rawEnv);
}