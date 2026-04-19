import { boolean, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { benchmarks } from './snapshots';

export const facilities = benchmarks.table(
  'facilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notionPageId: text('notion_page_id').notNull(),
    name: text('name').notNull(),
    reservationUrl: text('reservation_url').notNull(),
    /** 'reservanto' | 'jdemenato' | 'bizzi' | 'sroger' — zdroj z Notion. */
    reservationSystem: text('reservation_system').notNull(),
    active: boolean('active').notNull().default(true),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqNotionPageId: uniqueIndex('uq_facility_notion_page').on(t.notionPageId),
  }),
);

export type FacilityRow = typeof facilities.$inferSelect;
export type NewFacilityRow = typeof facilities.$inferInsert;
