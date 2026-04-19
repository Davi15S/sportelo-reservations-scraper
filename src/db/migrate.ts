import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, db } from './client';
import { logger } from '../utils/logger';

async function main() {
  logger.info('applying migrations to benchmarks schema');
  await migrate(db, {
    migrationsFolder: './drizzle',
    migrationsSchema: 'benchmarks',
    migrationsTable: '__benchmarks_migrations',
  });
  logger.info('migrations done');
  await closeDb();
}

main().catch((err) => {
  logger.error({ err }, 'migration failed');
  process.exit(1);
});
