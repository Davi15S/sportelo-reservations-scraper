import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  NOTION_TOKEN: z.string().min(1),
  NOTION_DATABASE_ID: z.string().min(1),
  SCRAPE_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  /** Optional — když chybí, Discord notifikace se neposílají. */
  DISCORD_WEBHOOK_URL: z.string().url().optional(),
  /** 'production' → bez tagu v Discord zprávách. Cokoli jiného (test / dev)
   *  → title se označí `[TEST]`. Default = dev (lokální běh). */
  APP_ENV: z.enum(['production', 'test', 'dev']).default('dev'),
  /** Optional HTTP(S) proxy pro Playwright. Formát:
   *    http://user:pass@host:port   (s basic auth)
   *    http://host:port             (bez auth)
   *  Používá se primárně na GH Actions / DO kde datacenter IP dostávají CF Turnstile.
   *  Residential/mobile proxy (Webshare, IPRoyal) ji obchází. Když chybí, scraper
   *  běží bez proxy (lokál, residential ISP). */
  PROXY_URL: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
