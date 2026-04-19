import { sql } from 'drizzle-orm';
import { closeDb, db } from '../db/client';
import { logger } from '../utils/logger';
import { todayInPrague } from '../utils/date';
import { flushErrors, normalizeError, type PendingError } from './errors';
import { sendAfternoonReport } from './notify';

/**
 * Agreguje snapshots do benchmarks.daily_summaries pro zadaný den.
 * Pro každý (facility, slot) bere nejčerstvější snapshot dne.
 * Idempotentní — upsert podle (facility_id, summary_date).
 */
export async function buildDailySummary(summaryDate: string): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO benchmarks.daily_summaries (
      facility_id, facility_name, sport, summary_date,
      total_slots, available_slots, booked_slots,
      occupancy_pct, courts_count, snapshot_count, last_scraped_at, generated_at
    )
    SELECT
      facility_id,
      facility_name,
      sport,
      date_checked AS summary_date,
      COUNT(*)::int AS total_slots,
      SUM((is_available)::int)::int AS available_slots,
      SUM((NOT is_available)::int)::int AS booked_slots,
      ROUND(100.0 * SUM((NOT is_available)::int)::numeric / NULLIF(COUNT(*), 0), 2) AS occupancy_pct,
      COUNT(DISTINCT court_id)::int AS courts_count,
      COUNT(*)::int AS snapshot_count,
      MAX(scraped_at) AS last_scraped_at,
      NOW() AS generated_at
    FROM (
      SELECT DISTINCT ON (facility_id, date_checked, time_slot, court_id)
        facility_id, facility_name, sport, date_checked, time_slot, court_id, is_available, scraped_at
      FROM benchmarks.snapshots
      WHERE date_checked = ${summaryDate}
      ORDER BY facility_id, date_checked, time_slot, court_id, scraped_at DESC
    ) latest
    GROUP BY facility_id, facility_name, sport, date_checked
    ON CONFLICT (facility_id, sport, summary_date) DO UPDATE SET
      facility_name = EXCLUDED.facility_name,
      total_slots = EXCLUDED.total_slots,
      available_slots = EXCLUDED.available_slots,
      booked_slots = EXCLUDED.booked_slots,
      occupancy_pct = EXCLUDED.occupancy_pct,
      courts_count = EXCLUDED.courts_count,
      snapshot_count = EXCLUDED.snapshot_count,
      last_scraped_at = EXCLUDED.last_scraped_at,
      generated_at = NOW()
  `);
  return result.rowCount ?? 0;
}

export async function runSummaryCli(): Promise<void> {
  const args = parseSummaryArgs(process.argv.slice(2));
  const target = args.target ?? todayInPrague();
  const errors: PendingError[] = [];
  logger.info({ target, notify: args.notify }, 'building daily summary');

  try {
    const n = await buildDailySummary(target);
    logger.info({ target, upserted: n }, 'summary done');
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'summary failed');
    errors.push(normalizeError({ stage: 'summary', err, errorType: 'db', context: { target } }));
    await flushErrors(errors, null).catch(() => undefined);
    process.exitCode = 1;
  }

  if (args.notify === 'afternoon') {
    try {
      await sendAfternoonReport({ results: [], errors });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'afternoon notify failed');
    }
  }

  await closeDb();
}

function parseSummaryArgs(argv: string[]): { target: string | null; notify: 'afternoon' | null } {
  let target: string | null = null;
  let notify: 'afternoon' | null = null;
  for (const a of argv) {
    if (a.startsWith('--notify=')) {
      notify = a.slice('--notify='.length) === 'afternoon' ? 'afternoon' : null;
    } else if (!a.startsWith('--')) {
      target = a;
    }
  }
  return { target, notify };
}
