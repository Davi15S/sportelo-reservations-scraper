import { integer, jsonb, pgEnum, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { benchmarks } from './snapshots';

export const validationStatus = pgEnum('validation_status', ['ok', 'anomaly', 'fail']);

export const scrapeRuns = benchmarks.table('scrape_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  facilitiesTotal: integer('facilities_total').notNull(),
  facilitiesOk: integer('facilities_ok').notNull(),
  facilitiesFailed: integer('facilities_failed').notNull(),
  snapshotsWritten: integer('snapshots_written').notNull(),
  validationStatus: text('validation_status').notNull(),
  validationNotes: text('validation_notes'),
  reportJson: jsonb('report_json').notNull(),
});

export type ScrapeRun = typeof scrapeRuns.$inferSelect;
export type NewScrapeRun = typeof scrapeRuns.$inferInsert;
