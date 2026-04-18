import { eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '../db/client';
import { facilities } from '../db/schema/facilities';
import { logger } from '../utils/logger';
import { listNotionFacilities } from './notion';
import type { Facility } from '../scrapers/types';

/**
 * Upsertuje Notion řádky do benchmarks.facilities (source of truth = Notion).
 * - nové Notion řádky: INSERT
 * - existující: UPDATE (name, URL, sport, active, last_synced_at)
 * - facility která už není v Notionu: active = false (soft deactivate)
 * Vrací seznam aktivních facility z DB (id = DB UUID).
 */
export async function syncFacilities(): Promise<Facility[]> {
  const notionRows = await listNotionFacilities();
  logger.info({ count: notionRows.length }, 'fetched Notion facilities');

  const notionIds = notionRows.map((r) => r.notionPageId);
  const now = new Date();

  for (const r of notionRows) {
    await db
      .insert(facilities)
      .values({
        notionPageId: r.notionPageId,
        name: r.name,
        reservationUrl: r.reservationUrl,
        sport: r.sport,
        active: r.active,
        lastSyncedAt: now,
      })
      .onConflictDoUpdate({
        target: facilities.notionPageId,
        set: {
          name: r.name,
          reservationUrl: r.reservationUrl,
          sport: r.sport,
          active: r.active,
          lastSyncedAt: now,
        },
      });
  }

  if (notionIds.length > 0) {
    await db
      .update(facilities)
      .set({ active: false, lastSyncedAt: now })
      .where(notInArray(facilities.notionPageId, notionIds));
  }

  const active = await db.select().from(facilities).where(eq(facilities.active, true));
  return active.map((row) => ({
    id: row.id,
    notionPageId: row.notionPageId,
    name: row.name,
    reservationUrl: row.reservationUrl,
    sport: row.sport,
    active: row.active,
  }));
}
