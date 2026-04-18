import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  schemaFilter: ['benchmarks'],
  migrations: {
    schema: 'benchmarks',
    table: '__benchmarks_migrations',
  },
  verbose: true,
  strict: true,
});
