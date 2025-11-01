import { drizzle } from 'drizzle-orm/libsql';
import { env } from '../lib/env';

export const db = drizzle({ 
  connection: { 
    url: env.TURSO_DB_URL, 
    authToken: env.TURSO_DB_AUTH_TOKEN
  }
});
