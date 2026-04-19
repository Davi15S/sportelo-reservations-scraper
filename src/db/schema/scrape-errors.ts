import { boolean, index, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { benchmarks } from './snapshots';
import { scrapeRuns } from './scrape-runs';
import { facilities } from './facilities';

export const scrapeErrors = benchmarks.table(
  'scrape_errors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Deterministický hash (stage + normalized message + facility_id). Stejná chyba = stejný fingerprint. */
    fingerprint: text('fingerprint').notNull(),
    scrapeRunId: uuid('scrape_run_id').references(() => scrapeRuns.id, { onDelete: 'set null' }),
    facilityId: uuid('facility_id').references(() => facilities.id, { onDelete: 'set null' }),
    facilityName: text('facility_name'),
    reservationUrl: text('reservation_url'),
    platform: text('platform'),
    /** 'bootstrap' | 'sync' | 'scrape' | 'parse' | 'insert' | 'validate' | 'summary' */
    stage: text('stage').notNull(),
    /** 'network' | 'timeout' | 'parse' | 'validation' | 'db' | 'unexpected' */
    errorType: text('error_type').notNull(),
    errorMessage: text('error_message').notNull(),
    errorStack: text('error_stack'),
    /** Extra kontext: URL, selektor, status code, response snippet, … */
    context: jsonb('context'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Kolikrát se stejná chyba objevila (bumped při dalším scrape se stejným fingerprintem). */
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    /** Jakmile true, nová instance stejného fingerprintu vytvoří nový řádek (ne bump). */
    resolved: boolean('resolved').notNull().default(false),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** Kdo/co to vyřešilo: 'manual', 'auto-fix PR #12', commit SHA, … */
    resolvedBy: text('resolved_by'),
    resolvedNote: text('resolved_note'),
  },
  (t) => ({
    idxFingerprint: index('idx_errors_fingerprint').on(t.fingerprint),
    idxResolved: index('idx_errors_resolved').on(t.resolved),
    idxRunId: index('idx_errors_run').on(t.scrapeRunId),
    idxFacilityId: index('idx_errors_facility').on(t.facilityId),
  }),
);

export type ScrapeError = typeof scrapeErrors.$inferSelect;
export type NewScrapeError = typeof scrapeErrors.$inferInsert;
