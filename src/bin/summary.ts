import { runSummaryCli } from '../pipeline/summary';
import { logger } from '../utils/logger';

runSummaryCli().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'summary failed');
  process.exit(1);
});
