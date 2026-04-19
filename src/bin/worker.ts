import cron from 'node-cron';
import { spawn } from 'node:child_process';
import { logger } from '../utils/logger';

const TZ = 'Europe/Prague';

/**
 * Persistent worker pro DO App Platform. Spouští scrape/summary přes fork
 * npm child procesu — každý běh má vlastní proces, čistý DB pool, čistý
 * playwright browser. Worker sám žije 24/7 a čeká na cron triggery v TZ
 * Europe/Prague (node-cron řeší DST automaticky).
 *
 * Časování:
 *   05:00 Praha — ranní scrape + migrace
 *   13:00 Praha — odpolední scrape + daily summary
 *
 * BEZPEČNOST: spawn bez shell (`shell: false`, default) a s fixním polem args
 * → žádný command injection vektor. Všechny argumenty jsou hardcoded.
 */

const NPM_CMD = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runNpm(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(NPM_CMD, args, { stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      logger.error({ err: err.message, args }, 'npm spawn error');
      resolve(1);
    });
  });
}

async function morningRun(): Promise<void> {
  logger.info('cron trigger: morning');
  const migrateCode = await runNpm(['run', 'db:migrate']);
  if (migrateCode !== 0) logger.warn({ code: migrateCode }, 'db:migrate exited non-zero');
  const scrapeCode = await runNpm(['run', 'scrape', '--', '--notify=morning']);
  logger.info({ code: scrapeCode }, 'morning finished');
}

async function afternoonRun(): Promise<void> {
  logger.info('cron trigger: afternoon');
  const scrapeCode = await runNpm(['run', 'scrape', '--', '--notify=afternoon']);
  logger.info({ code: scrapeCode }, 'afternoon scrape finished');
  const summaryCode = await runNpm(['run', 'summary', '--', '--notify=afternoon']);
  logger.info({ code: summaryCode }, 'afternoon summary finished');
}

cron.schedule(
  '0 5 * * *',
  () => {
    morningRun().catch((err) => logger.error({ err: err instanceof Error ? err.message : String(err) }, 'morning failed'));
  },
  { timezone: TZ },
);

cron.schedule(
  '0 13 * * *',
  () => {
    afternoonRun().catch((err) => logger.error({ err: err instanceof Error ? err.message : String(err) }, 'afternoon failed'));
  },
  { timezone: TZ },
);

logger.info({ tz: TZ, crons: ['0 5 * * *', '0 13 * * *'] }, 'worker started — waiting for cron');

// Keep process alive — App Platform worker očekává nonstop proces.
process.stdin.resume();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'worker shutting down');
    process.exit(0);
  });
}
