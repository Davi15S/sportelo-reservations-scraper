import pLimit from 'p-limit';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { syncFacilities } from '../sources/sync';
import { scrapeFacility } from '../scrapers/dispatch';
import { closeBrowser } from '../scrapers/browser';
import { closeDb } from '../db/client';
import { insertScrapeRun, insertSnapshots } from './upsert';
import { buildReport } from './report';
import { validateRun } from './validate';
import { flushErrors, normalizeError, type PendingError } from './errors';
import { sendScrapeReport } from './notify';
import type { FacilityScrapeResult, Facility } from '../scrapers/types';
import type { NewSnapshot } from '../db/schema/index';

type RunOptions = {
  dryRun: boolean;
  facilityFilter: string | null;
  notify: 'morning' | 'afternoon' | null;
};

export async function run(opts: RunOptions): Promise<void> {
  const startedAt = new Date();
  const pendingErrors: PendingError[] = [];
  logger.info({ dryRun: opts.dryRun, facilityFilter: opts.facilityFilter }, 'scrape started');

  let all: Facility[] = [];
  try {
    all = await syncFacilities();
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'sync failed');
    pendingErrors.push(normalizeError({ stage: 'sync', err }));
  }
  const targets = all.filter((f) => !opts.facilityFilter || f.id === opts.facilityFilter);

  logger.info({ total: all.length, active: targets.length }, 'facilities synced from Notion');

  const limit = pLimit(env.SCRAPE_CONCURRENCY);
  const results: FacilityScrapeResult[] = await Promise.all(
    targets.map((f) =>
      limit(async () => {
        try {
          return await scrapeFacility(f);
        } catch (err) {
          return {
            status: 'failed' as const,
            facility: f,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    ),
  );

  for (const r of results) {
    if (r.status !== 'failed') continue;
    pendingErrors.push(
      normalizeError({
        stage: 'scrape',
        err: new Error(r.error),
        facility: { id: r.facility.id, name: r.facility.name, reservationUrl: r.facility.reservationUrl },
        platform: detectPlatform(r.facility.reservationUrl),
      }),
    );
  }

  const rows = results.flatMap((r) => (r.status === 'ok' ? toSnapshotRows(r.facility, r.snapshots, r.rawSample) : []));
  const validation = validateRun(results);

  let snapshotsWritten = 0;
  if (!opts.dryRun && rows.length > 0) {
    try {
      snapshotsWritten = await insertSnapshots(rows);
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'insertSnapshots failed');
      pendingErrors.push(normalizeError({ stage: 'insert', err, errorType: 'db', context: { rowCount: rows.length } }));
    }
  }

  const report = buildReport({
    startedAt,
    results,
    snapshotsWritten,
    validationStatus: validation.status,
    validationNotes: validation.notes,
  });

  logger.info({ validation: validation.status, snapshotsWritten, errorCount: pendingErrors.length }, 'run finished');

  let scrapeRunId: string | null = null;
  if (!opts.dryRun) {
    try {
      scrapeRunId = await insertScrapeRun({
        startedAt,
        finishedAt: new Date(),
        facilitiesTotal: report.facilitiesTotal,
        facilitiesOk: report.facilitiesOk,
        facilitiesFailed: report.facilitiesFailed,
        snapshotsWritten,
        validationStatus: validation.status,
        validationNotes: validation.notes,
        reportJson: report,
      });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'insertScrapeRun failed');
      pendingErrors.push(normalizeError({ stage: 'insert', err, errorType: 'db' }));
    }

    if (pendingErrors.length > 0) {
      try {
        const n = await flushErrors(pendingErrors, scrapeRunId);
        logger.info({ errorsWritten: n, scrapeRunId }, 'scrape errors persisted');
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'flushErrors failed');
      }
    }
  }

  if (opts.dryRun) console.log(JSON.stringify({ ...report, errors: pendingErrors }, null, 2));

  if (!opts.dryRun && (opts.notify === 'morning' || opts.notify === 'afternoon')) {
    try {
      await sendScrapeReport({ phase: opts.notify, results, errors: pendingErrors });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'scrape notify failed');
    }
  }
  // Denní shrnutí (📊) posílá bin/summary.ts po vygenerování daily_summaries.

  await shutdown();

  if (pendingErrors.length > 0 || validation.status === 'fail') {
    process.exitCode = 1;
  }
}

function detectPlatform(url: string): string | null {
  const host = safeHost(url);
  if (!host) return null;
  if (host.endsWith('.e-rezervace.cz') || host === 'e-rezervace.cz') return 'smarcoms';
  return 'reservanto';
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function toSnapshotRows(
  facility: Facility,
  slots: {
    dateChecked: string;
    timeSlot: string;
    courtId: string;
    isAvailable: boolean;
    sport: string | null;
  }[],
  rawSample: unknown,
): NewSnapshot[] {
  return slots.map((s) => ({
    facilityId: facility.id,
    facilityName: facility.name,
    reservationUrl: facility.reservationUrl,
    sport: s.sport ?? facility.sport,
    dateChecked: s.dateChecked,
    timeSlot: s.timeSlot,
    courtId: s.courtId,
    isAvailable: s.isAvailable,
    rawPayload: rawSample ?? null,
  }));
}

async function shutdown(): Promise<void> {
  await closeBrowser();
  await closeDb();
}
