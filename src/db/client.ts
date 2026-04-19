import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import { env } from '../config/env';
import * as schema from './schema/index';

/**
 * `pg` (node-postgres) parses `?sslmode=...` from the connection string, but
 * `sslmode=no-verify` isn't a standard libpq value and gets mapped to
 * `ssl: true` — which Node's tls module treats as strict chain verification.
 * DigitalOcean managed Postgres uses a DO-signed chain that isn't in Node's
 * default trust store, so TLS rejects it with `SELF_SIGNED_CERT_IN_CHAIN`.
 *
 * Override: pass an explicit `ssl` object to Pool (user options win over the
 * connection-string-derived ssl flag). Localhost keeps plaintext for Docker.
 */
function buildPoolConfig(): PoolConfig {
  const base: PoolConfig = {
    connectionString: env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
  };

  let host = '';
  try {
    host = new URL(env.DATABASE_URL).hostname.toLowerCase();
  } catch {
    /* ignore */
  }
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!isLocal) {
    base.ssl = { rejectUnauthorized: false };
  }

  return base;
}

export const pool = new Pool(buildPoolConfig());

export const db = drizzle(pool, { schema });

export async function closeDb(): Promise<void> {
  await pool.end();
}
