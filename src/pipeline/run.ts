import pLimit from 'p-limit';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { listFacilities } from '../sources/notion';
import { scrapeFacility } from '../scrapers/dispatch';
import { closeBrowser } from '../scrapers/browser';
import { closeDb } from '../db/client';
import { insertScrapeRun, insertSnapshots } from './upsert';
import { buildReport, saveReportToDisk } from './report';
import { validateRun } from './validate';
import type { FacilityScrapeResult, Facility } from '../scrapers/types';
import type { NewSnapshot } from '../db/schema/index';

type RunOptions = {
  dryRun: boolean;
  facilityFilter: string | null;
};

export async function run(opts: RunOptions): Promise<void> {
  const startedAt = new Date();
  logger.info({ dryRun: opts.dryRun, facilityFilter: opts.facilityFilter }, 'scrape started');

  const all = await listFacilities();
  const targets = all.filter((f) => f.active).filter((f) => !opts.facilityFilter || f.id === opts.facilityFilter);

  logger.info({ total: all.length, active: targets.length }, 'facilities loaded from Notion');
  if (targets.length === 0) {
    logger.warn('no active facilities — nothing to do');
    await shutdown();
    return;
  }

  const limit = pLimit(env.SCRAPE_CONCURRENCY);
  const results = await Promise.all(
    targets.map((f) => limit(() => scrapeFacility(f).catch<FacilityScrapeResult>((err) => ({
      status: 'failed',
      facility: f,
      error: err instanceof Error ? err.message : String(err),
    })))),
  );

  const rows = results.flatMap((r) => (r.status === 'ok' ? toSnapshotRows(r.facility, r.snapshots, r.rawSample) : []));
  const validation = validateRun(results);

  let snapshotsWritten = 0;
  if (!opts.dryRun && rows.length > 0) {
    snapshotsWritten = await insertSnapshots(rows);
  }

  const report = buildReport({
    startedAt,
    results,
    snapshotsWritten,
    validationStatus: validation.status,
    validationNotes: validation.notes,
  });

  const reportPath = await saveReportToDisk(report);
  logger.info({ reportPath, validation: validation.status }, 'report saved');

  if (!opts.dryRun) {
    await insertScrapeRun({
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
  }

  if (opts.dryRun) console.log(JSON.stringify(report, null, 2));

  await shutdown();
}

function toSnapshotRows(
  facility: Facility,
  slots: { dateChecked: string; timeSlot: string; courtId: string; isAvailable: boolean }[],
  rawSample: unknown,
): NewSnapshot[] {
  return slots.map((s) => ({
    facilityId: facility.id,
    facilityName: facility.name,
    reservationUrl: facility.reservationUrl,
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
