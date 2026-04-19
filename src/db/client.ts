import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/env';
import * as schema from './schema/index';

/**
 * Uses node-postgres (`pg`). `pg` parses `?sslmode=...` from the connection
 * string directly, including DO's `sslmode=no-verify` idiom — no extra TLS
 * config needed for DigitalOcean managed Postgres.
 *
 * Mirrors the pattern used by the Sportelo backend (apps/backend/libs/drizzle).
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema });

export async function closeDb(): Promise<void> {
  await pool.end();
}
