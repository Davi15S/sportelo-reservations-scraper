import { run } from './pipeline/run';
import { logger } from './utils/logger';

type Notify = 'morning' | 'afternoon' | null;

function parseArgs(argv: string[]): { dryRun: boolean; facilityFilter: string | null; notify: Notify } {
  const dryRun = argv.includes('--dry-run');
  const facilityArg = argv.find((a) => a.startsWith('--facility='));
  const facilityFilter = facilityArg ? facilityArg.slice('--facility='.length) : null;
  const notifyArg = argv.find((a) => a.startsWith('--notify='));
  const notifyRaw = notifyArg ? notifyArg.slice('--notify='.length) : null;
  const notify: Notify = notifyRaw === 'morning' || notifyRaw === 'afternoon' ? notifyRaw : null;
  return { dryRun, facilityFilter, notify };
}

const opts = parseArgs(process.argv.slice(2));

/**
 * Explicitní `process.exit()` po run/crash — bez něj by Node event loop čekal na
 * pending handles (playwright WebSocket, node-pg timeouts), což nechá GH Actions
 * worker stucked dokud workflow timeout nekillne job. Pečlivé `closeBrowser()`/
 * `closeDb()` v `shutdown()` by mělo stačit, ale pro jistotu vynutíme exit tady.
 */
run(opts)
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'scrape crashed');
    process.exit(1);
  });
