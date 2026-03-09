import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client/web';
import type { ENV } from '../lib/env';

export function createDb(env: ENV) {
  const client = createClient({
    url: env.TURSO_DB_URL,
    authToken: env.TURSO_DB_AUTH_TOKEN,
  });
  return drizzle(client);
}

