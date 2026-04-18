import { date, integer, numeric, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { benchmarks } from './snapshots';

export const dailySummaries = benchmarks.table(
  'daily_summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: text('facility_id').notNull(),
    facilityName: text('facility_name').notNull(),
    sport: text('sport').notNull(),
    summaryDate: date('summary_date').notNull(),
    totalSlots: integer('total_slots').notNull(),
    availableSlots: integer('available_slots').notNull(),
    bookedSlots: integer('booked_slots').notNull(),
    occupancyPct: numeric('occupancy_pct', { precision: 5, scale: 2 }).notNull(),
    courtsCount: integer('courts_count').notNull(),
    snapshotCount: integer('snapshot_count').notNull(),
    lastScrapedAt: timestamp('last_scraped_at', { withTimezone: true }).notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqFacilitySportDate: uniqueIndex('uq_summary_facility_sport_date').on(t.facilityId, t.sport, t.summaryDate),
  }),
);

export type DailySummary = typeof dailySummaries.$inferSelect;
export type NewDailySummary = typeof dailySummaries.$inferInsert;
