import { run } from './pipeline/run';
import { logger } from './utils/logger';

function parseArgs(argv: string[]): { dryRun: boolean; facilityFilter: string | null } {
  const dryRun = argv.includes('--dry-run');
  const facilityArg = argv.find((a) => a.startsWith('--facility='));
  const facilityFilter = facilityArg ? facilityArg.slice('--facility='.length) : null;
  return { dryRun, facilityFilter };
}

const opts = parseArgs(process.argv.slice(2));

run(opts).catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'scrape crashed');
  process.exit(1);
});
