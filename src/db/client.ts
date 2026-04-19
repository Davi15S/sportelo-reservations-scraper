import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config/env';
import * as schema from './schema/index';

/**
 * DigitalOcean managed Postgres používá DO-signed cert (end-entity je self-signed
 * z pohledu Node trust store). Bez CA bundle musíme driver nechat SSL zapnout
 * ale nepoužívat verifikaci chain-of-trust.
 *
 * postgres-js idiom: `ssl: 'require'` = SSL yes, skip cert verify.
 * Objekt `{ rejectUnauthorized: false }` bývá přepsán pokud URL nese sslmode —
 * explicitně strip `sslmode` z URL aby user-side option fungovala.
 */
function stripSslmode(raw: string): string {
  try {
    const u = new URL(raw);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return raw;
  }
}

function resolveSsl(url: string): 'require' | false {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
  } catch {
    /* fall through */
  }
  return 'require';
}

const rawUrl = env.DATABASE_URL;
const client = postgres(stripSslmode(rawUrl), {
  max: 5,
  ssl: resolveSsl(rawUrl),
});

export const db = drizzle(client, { schema });

export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}
