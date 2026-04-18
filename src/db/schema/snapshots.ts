import { boolean, date, index, jsonb, pgSchema, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';

export const benchmarks = pgSchema('benchmarks');

export const snapshots = benchmarks.table(
  'snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: text('facility_id').notNull(),
    facilityName: text('facility_name').notNull(),
    reservationUrl: text('reservation_url').notNull(),
    sport: text('sport').notNull(),
    scrapedAt: timestamp('scraped_at', { withTimezone: true }).notNull().defaultNow(),
    dateChecked: date('date_checked').notNull(),
    timeSlot: time('time_slot').notNull(),
    courtId: text('court_id').notNull(),
    isAvailable: boolean('is_available').notNull(),
    rawPayload: jsonb('raw_payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxFacilityDate: index('idx_snap_facility_date').on(t.facilityId, t.dateChecked),
    idxScrapedAt: index('idx_snap_scraped_at').on(t.scrapedAt),
  }),
);

export type Snapshot = typeof snapshots.$inferSelect;
export type NewSnapshot = typeof snapshots.$inferInsert;
